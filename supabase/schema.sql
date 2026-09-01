-- ============================================================
-- Room Booking App — Supabase schema (authoritative)
-- Run in Supabase Dashboard -> SQL Editor -> New query.
--
-- This file supersedes the original schema.sql plus migrations 002-004.
-- It is IDEMPOTENT: safe to run against the live database as-is. Policies
-- are dropped before being recreated, functions use CREATE OR REPLACE, and
-- the realtime publication is added conditionally.
--
-- IT DOES NOT DESTROY DATA. There is no DROP TABLE anywhere in this file.
--
-- Maintenance rule: if you change something in the SQL editor, change it
-- HERE too. Three separate security problems in this system went unnoticed
-- for months purely because the live database and this file had drifted —
-- release_own_booking existed only in the database and so was never
-- reviewed, and it turned out to let anyone extend any booking.
--
-- Last hardening pass (see sections 2, 3, 6, 7, 8):
--   - The three "Admins can ..." policies were unconditional against the
--     `authenticated` role. Now gated on public.is_admin(). Section 2.
--   - pg_temp added to search_path on every SECURITY DEFINER function.
--   - Section 12 gained checks for both of the above, plus a view check.
--   - Section 13 records reviewed-but-unapplied items.
-- ============================================================


-- ============================================================
-- 1. BOOKINGS TABLE
-- ============================================================
create table if not exists public.bookings (
  booking_id        text primary key,
  room              text not null check (room in (
                      'brihaspati','vedvyas','conf2f','parashurama','pingala',
                      'chanakya','bhardwaja','vishwamitra','vasistha','sharada'
                    )),
  booked_by         text not null check (char_length(booked_by) <= 80),
  purpose           text check (char_length(purpose) <= 100),
  booking_date      date not null,
  start_time        time not null,
  end_time          time not null,
  attendees         integer check (attendees between 1 and 500),
  status            text not null default 'Confirmed'
                      check (status in ('Confirmed','Pending','Cancelled','Rejected')),
  end_date          date,
  conflict_resolved boolean not null default false,
  conflict_note     text
);

-- Creation timestamp. NULLABLE on purpose: rows created before this column
-- existed have no recoverable creation time, and defaulting them to now()
-- would make the oldest rows look like the newest. Treat NULL as "unknown,
-- sort oldest" (order by created_at desc nulls last).
alter table public.bookings
  add column if not exists created_at timestamptz default now();

create index if not exists idx_bookings_date       on public.bookings (booking_date);
create index if not exists idx_bookings_room_date  on public.bookings (room, booking_date);
create index if not exists idx_bookings_status     on public.bookings (status);
create index if not exists idx_bookings_created_at on public.bookings (created_at desc nulls last);


-- ============================================================
-- 2. ROW LEVEL SECURITY — bookings
-- ============================================================
alter table public.bookings enable row level security;

drop policy if exists "Public can view bookings"           on public.bookings;
drop policy if exists "Public can create pending requests" on public.bookings;
drop policy if exists "Admins can insert any booking"      on public.bookings;
drop policy if exists "Admins can update bookings"         on public.bookings;
drop policy if exists "Admins can delete bookings"         on public.bookings;

-- Anyone with the publishable key can read every booking. This is what makes
-- the public status board work.
--
-- KNOWN EXPOSURE, accepted: booked_by, purpose, room and date are therefore
-- world-readable to anyone who has the key, and the key is in the page
-- source. Do not put anything confidential in `purpose`.
create policy "Public can view bookings"
  on public.bookings for select
  using (true);

-- Anyone can create a booking REQUEST, but it must land as Pending.
-- Confirmed bookings are only ever created by a logged-in admin.
create policy "Public can create pending requests"
  on public.bookings for insert
  with check (
    status = 'Pending'
    and conflict_resolved = false
    and (conflict_note is null or conflict_note = '')
  );

-- Identity check for the three admin policies below.
--
-- These policies previously used `using (true)` / `with check (true)` against
-- the `authenticated` role. Postgres ignores policy NAMES, so despite being
-- called "Admins can ...", ANY authenticated session had full insert, update
-- and delete on every booking. The only thing preventing that was signups
-- being disabled in the Supabase dashboard — a single control, living in a UI
-- rather than in this file, that nobody was reviewing.
--
-- Two independent controls now: dashboard signups disabled stops accounts
-- being created, and this stops a created account from doing anything.
--
-- Keep this address in step with ADMIN_EMAIL in js/config.js. Changing the
-- admin requires editing BOTH. Pinning to auth.uid() instead would survive an
-- email change, but email keeps the two files legible side by side.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'email') = 'shaunakmistry4@gmail.com', false)
$$;

-- Only the three policies below call this, and all three apply to the
-- `authenticated` role only, so anon never evaluates it and must not hold the
-- default PUBLIC execute grant — otherwise is_admin appears in the section 12
-- anon_can_call check and muddies the expected list.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "Admins can insert any booking"
  on public.bookings for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update bookings"
  on public.bookings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete bookings"
  on public.bookings for delete
  to authenticated
  using (public.is_admin());


-- ============================================================
-- 3. SELF-SERVICE CANCEL / RELEASE (SECURITY DEFINER RPCs)
-- ============================================================
-- These are the ONLY way an anonymous caller can modify a row. Both run as
-- the owner and bypass RLS, so their internal checks ARE the security
-- boundary — the client-side name check in cancel-release.js is a UX nicety.
--
-- On `set search_path = public, pg_temp` (used on every SECURITY DEFINER
-- function in this file): naming pg_temp explicitly is required, not
-- cosmetic. If it is omitted, Postgres searches the temp schema FIRST for
-- relation names, and TEMPORARY is granted to PUBLIC by default — so a caller
-- can create a temp table named `bookings` and have a definer function
-- operate on theirs instead of the real one. Keep it on every definer
-- function added here.
--
-- KNOWN WEAKNESS, accepted: the identity check compares the typed name
-- against booked_by, but booked_by is world-readable via the SELECT policy
-- above. Anyone can read a name and then cancel or shorten that booking.
-- This prevents accidents, not deliberate misuse. Closing it properly needs
-- a per-booking token issued at creation time and required here.

create or replace function public.cancel_own_booking(
  p_booking_id  text,
  p_booker_name text
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.bookings;
begin
  select * into v_row from public.bookings where booking_id = p_booking_id;

  if not found then
    return json_build_object('ok', false, 'error', 'Not found: ' || p_booking_id);
  end if;

  if lower(trim(v_row.booked_by)) <> lower(trim(p_booker_name)) then
    return json_build_object('ok', false, 'error', 'Name does not match booking.');
  end if;

  if v_row.status = 'Cancelled' then
    return json_build_object('ok', false, 'error', 'Booking already cancelled.');
  end if;

  update public.bookings set status = 'Cancelled' where booking_id = p_booking_id;

  return json_build_object('ok', true, 'action', 'cancelled', 'BookingID', p_booking_id);
end;
$$;

create or replace function public.release_own_booking(
  p_booking_id  text,
  p_booker_name text,
  p_end_time    time,
  p_end_date    date
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     public.bookings;
  v_start   timestamp;
  v_old_end timestamp;
  v_new_end timestamp;
begin
  select * into v_row from public.bookings where booking_id = p_booking_id;

  if not found then
    return json_build_object('ok', false, 'error', 'Not found: ' || p_booking_id);
  end if;

  if lower(trim(v_row.booked_by)) <> lower(trim(p_booker_name)) then
    return json_build_object('ok', false, 'error', 'Name does not match booking.');
  end if;

  -- Releasing a Cancelled or Rejected booking would quietly reanimate its
  -- slot in the status grid.
  if v_row.status <> 'Confirmed' then
    return json_build_object('ok', false, 'error', 'Only a Confirmed booking can be released.');
  end if;

  v_start   := v_row.booking_date + v_row.start_time;
  v_old_end := coalesce(v_row.end_date, v_row.booking_date) + v_row.end_time;
  v_new_end := p_end_date + p_end_time;

  -- CRITICAL. The original version wrote p_end_time/p_end_date straight into
  -- the row with no validation, so the same call that shortens a booking also
  -- EXTENDED one: release_own_booking(<any id>, <name read from the public
  -- API>, '23:59', '2027-12-31') occupied any room for a year.
  -- Release means ending early, and only early.
  if v_new_end > v_old_end then
    return json_build_object('ok', false, 'error', 'Release cannot extend a booking.');
  end if;

  if v_new_end < v_start then
    return json_build_object('ok', false, 'error', 'Release time is before the booking starts — cancel it instead.');
  end if;

  update public.bookings
     set end_time = p_end_time,
         end_date = p_end_date
   where booking_id = p_booking_id;

  return json_build_object('ok', true, 'action', 'released', 'BookingID', p_booking_id);
end;
$$;

-- Must be anon-callable: this is the public self-service flow. The functions
-- above do the authorization.
revoke all on function public.cancel_own_booking(text, text)              from public;
revoke all on function public.release_own_booking(text, text, time, date) from public;
grant execute on function public.cancel_own_booking(text, text)              to anon, authenticated;
grant execute on function public.release_own_booking(text, text, time, date) to anon, authenticated;


-- ============================================================
-- 4. ARCHIVE
-- ============================================================
create table if not exists public.bookings_archive (like public.bookings including all);

-- `like ... including all` copies columns, defaults, constraints and indexes.
-- It does NOT copy RLS enablement or policies. Supabase's default grants give
-- anon table access in the public schema with RLS as the only gate, so this
-- table sat world-readable AND world-writable — holding archived copies of
-- every booking — until it was enabled. No policies are defined, so nothing
-- but service_role (which bypasses RLS) can touch it.
--
-- RLS ON WITH ZERO POLICIES IS INTENTIONAL here too. Do not add policies. Do
-- not set FORCE ROW LEVEL SECURITY.
alter table public.bookings_archive enable row level security;

create or replace function public.archive_old_bookings(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  -- p_days is caller-supplied and a negative value inverts the date test:
  -- archive_old_bookings(-99999) would move every non-Pending booking out of
  -- the live table. Combined with the default PUBLIC execute grant that this
  -- function originally inherited, that was a one-request wipe.
  if p_days is null or p_days < 1 then
    raise exception 'p_days must be >= 1 (got %).', p_days;
  end if;

  with moved as (
    delete from public.bookings
    where booking_date < (current_date - p_days)
      and status <> 'Pending'
    returning *
  )
  insert into public.bookings_archive select * from moved;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default. This function deletes from
-- bookings and bypasses RLS, so it must never be reachable with the
-- publishable key. Nothing in the browser calls it — run it from the SQL
-- editor or a scheduled job.
revoke all on function public.archive_old_bookings(integer) from public, anon, authenticated;
grant execute on function public.archive_old_bookings(integer) to service_role;


-- ============================================================
-- 5. REALTIME
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;


-- ============================================================
-- 6. BOOKING RATE LIMIT
-- ============================================================
-- 5 inserts/min for an authenticated admin, 2/min for anonymous requests
-- keyed by the name typed into the form. Not spoof-proof — changing the name
-- resets the counter — but it deters double-submits and accidental spam.
create table if not exists public.booking_rate_log (
  id         bigint generated always as identity primary key,
  actor      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_log_actor_time
  on public.booking_rate_log (actor, created_at);
alter table public.booking_rate_log enable row level security;
-- RLS ON WITH ZERO POLICIES IS INTENTIONAL. This denies all access to anon and
-- authenticated. Writes still work because rls_forced = false, so the owner
-- bypasses RLS and the SECURITY DEFINER trigger below (which runs as owner)
-- is unaffected. DO NOT add policies here to "fix" the 0 count, and DO NOT set
-- FORCE ROW LEVEL SECURITY — either would break the trigger silently, with no
-- error and nothing in the logs.

create or replace function public.enforce_booking_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      text;
  v_limit      integer;
  v_recent_cnt integer;
begin
  if auth.role() = 'authenticated' then
    v_actor := 'auth:' || auth.uid()::text;
    v_limit := 5;
  else
    v_actor := 'name:' || lower(trim(new.booked_by));
    v_limit := 2;
  end if;

  delete from public.booking_rate_log where created_at < now() - interval '2 minutes';

  select count(*) into v_recent_cnt
  from public.booking_rate_log
  where actor = v_actor and created_at > now() - interval '60 seconds';

  if v_recent_cnt >= v_limit then
    raise exception 'Rate limit exceeded: max % booking(s) per minute. Please wait a moment and try again.', v_limit
      using errcode = 'P0001';
  end if;

  insert into public.booking_rate_log (actor) values (v_actor);
  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_rate_limit on public.bookings;
create trigger trg_enforce_booking_rate_limit
  before insert on public.bookings
  for each row
  execute function public.enforce_booking_rate_limit();


-- ============================================================
-- 7. ROOM CAPACITY
-- ============================================================
-- Mirrors the seat counts in js/config.js ROOMS. Keep the two in step.
create or replace function public.enforce_room_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cap integer;
begin
  v_cap := case new.room
    when 'chanakya' then 45
    when 'conf2f'   then 5
    else 30
  end;
  if new.attendees is not null and new.attendees > v_cap then
    raise exception 'Room % holds up to % people (got %).', new.room, v_cap, new.attendees;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_room_capacity on public.bookings;
create trigger trg_enforce_room_capacity
  before insert or update on public.bookings
  for each row
  execute function public.enforce_room_capacity();

-- Trigger functions are invoked by the trigger, never called directly, so
-- they do not need an execute grant. They inherited the PUBLIC default.
revoke all on function public.enforce_booking_rate_limit() from public, anon, authenticated;
revoke all on function public.enforce_room_capacity()      from public, anon, authenticated;


-- ============================================================
-- 8. LOGIN RATE LIMIT
-- ============================================================
-- Server-side enforcement. The app also counts attempts in JS, but that is
-- trivially bypassed by refreshing the page.
--
-- The first version of this counted EVERY row in the window with no client
-- identity in the WHERE clause, so ten attempts from anyone in five minutes
-- locked out everyone — including the admin with the correct password. It
-- also logged successful attempts, so normal use consumed the budget.
--
-- Honest limitation: this gates logins made through this app's UI. It cannot
-- block someone calling Supabase's Auth API directly with the publishable
-- key and the admin email. That needs a WAF in front of the domain.
create table if not exists public.login_attempt_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
alter table public.login_attempt_log
  add column if not exists ip inet;
create index if not exists login_attempt_log_ip_time_idx
  on public.login_attempt_log (ip, created_at desc);
alter table public.login_attempt_log enable row level security;
-- RLS ON WITH ZERO POLICIES IS INTENTIONAL — see the note on booking_rate_log
-- in section 6. Only the SECURITY DEFINER functions below touch this table.
-- Do not add policies. Do not set FORCE ROW LEVEL SECURITY.

-- Resolve the real caller address.
--
-- inet_client_addr() alone is WRONG here. Browser calls arrive via PostgREST,
-- so it returns PostgREST's own address — identical for every user on the
-- planet — which silently collapses the per-IP partition back to global. That
-- is the original bug this section was meant to fix, and the comment below
-- flagged it as unverified. It is now handled rather than assumed.
--
-- Order of preference:
--   1. cf-connecting-ip  — set by Cloudflare in front of Supabase, and the
--      most trustworthy of the three because the client cannot forge it past
--      the edge.
--   2. x-forwarded-for   — first entry is the originating client.
--   3. inet_client_addr() — direct connections (SQL editor, psql, cron).
--
-- IPv6 is masked to its /64. A client gets a whole /64 and privacy extensions
-- rotate the address inside it, so counting exact addresses gives one attacker
-- unlimited identities. A /64 is normally one household or one handset, so
-- collateral blocking is negligible.
--
-- HONEST LIMITATION: these headers are ultimately client-influenced. This
-- makes evasion materially harder, not impossible. Section 8's note stands —
-- a real answer needs a WAF in front of the domain.
create or replace function public.client_ip()
returns inet
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_hdrs jsonb;
  v_raw  text;
  v_ip   inet;
begin
  begin
    v_hdrs := current_setting('request.headers', true)::jsonb;
  exception when others then
    v_hdrs := null;
  end;

  if v_hdrs is not null then
    -- Confirmed present on this project (dumped from request.headers):
    -- cf-connecting-ip, sb-forwarded-for and x-forwarded-for all carried the
    -- real client address. cf-connecting-ip first: Cloudflare sets it at the
    -- edge and the client cannot forge it past that point.
    v_raw := coalesce(
      nullif(btrim(v_hdrs ->> 'cf-connecting-ip'), ''),
      nullif(btrim(v_hdrs ->> 'sb-forwarded-for'), ''),
      nullif(btrim(v_hdrs ->> 'x-real-ip'), ''),
      nullif(btrim(split_part(coalesce(v_hdrs ->> 'x-forwarded-for', ''), ',', 1)), '')
    );
  end if;

  if v_raw is not null then
    begin
      v_ip := v_raw::inet;
    exception when others then
      v_ip := null;   -- malformed or spoofed garbage: fall through
    end;
  end if;

  v_ip := coalesce(v_ip, inet_client_addr());

  if v_ip is null then
    return null;
  end if;

  -- network() is required, not decorative: set_masklen alone changes the
  -- netmask but LEAVES THE HOST BITS INTACT, so two addresses in the same /64
  -- still compare unequal and nothing groups.
  if family(v_ip) = 6 then
    return network(set_masklen(v_ip, 64));
  end if;

  return v_ip;
end;
$$;

-- Called only from the two SECURITY DEFINER functions below, which run as
-- owner. No client needs execute, and withholding it keeps the section 12
-- anon_can_call list at exactly five.
revoke all on function public.client_ip() from public, anon, authenticated;

create or replace function public.check_login_rate_limit()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent_cnt integer;
  v_limit      integer  := 10;
  v_window     interval := interval '5 minutes';
  v_oldest     timestamptz;
  v_ip         inet     := public.client_ip();
begin
  delete from public.login_attempt_log where created_at < now() - interval '30 minutes';

  -- Partition key comes from client_ip() above, not inet_client_addr().
  -- Do not "simplify" this back — see the note on client_ip().
  select count(*), min(created_at)
    into v_recent_cnt, v_oldest
  from public.login_attempt_log
  where created_at > now() - v_window
    and ip is not distinct from v_ip;

  if v_recent_cnt >= v_limit then
    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds', greatest(1, extract(epoch from (v_oldest + v_window - now()))::int)
    );
  end if;

  -- Deliberately does not log here. Only failures count, via
  -- log_failed_login() below, called from js/api/auth.js.
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.log_failed_login()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- MUST use the same derivation as check_login_rate_limit, or logged rows
  -- never match the rows it counts and the limiter does nothing.
  --
  -- Caller note (js/api/auth.js): this RPC is fire-and-forget, but it must be
  -- invoked with .then(), NOT .catch(). PostgrestBuilder is a lazy thenable
  -- with no catch() method — `supabase.rpc(...).catch(...)` throws TypeError
  -- and the request is never sent at all. That bug silently disabled this
  -- limiter, the client-side attempt counter and the remaining-attempts
  -- message, all three, for months.
  insert into public.login_attempt_log (ip) values (public.client_ip());
end;
$$;

revoke all on function public.check_login_rate_limit() from public;
revoke all on function public.log_failed_login()       from public;
grant execute on function public.check_login_rate_limit() to anon, authenticated;
grant execute on function public.log_failed_login()       to anon, authenticated;


-- ============================================================
-- 9. BASE36 HELPER
-- ============================================================
-- Booking ids are 'b' + creation-time-in-base36 (8 chars) + 12 random chars.
-- Used to backfill created_at. Legacy rows also start with 'b' followed by 8
-- base36 chars, but those chars are NOT a timestamp — they decode to dates in
-- 2055-2059. Any backfill must therefore range-check the result, not just
-- pattern-match the id. See section 11.
create or replace function public.base36_to_bigint(p_text text)
returns bigint
language plpgsql
immutable
as $$
declare
  v_result bigint := 0;
  v_char   text;
  v_digit  int;
begin
  for i in 1..length(p_text) loop
    v_char  := lower(substring(p_text from i for 1));
    v_digit := position(v_char in '0123456789abcdefghijklmnopqrstuvwxyz') - 1;
    if v_digit < 0 then
      return null;
    end if;
    v_result := v_result * 36 + v_digit;
  end loop;
  return v_result;
end;
$$;


-- ============================================================
-- 10. NOT MANAGED HERE
-- ============================================================
-- public.rls_auto_enable() is an EVENT TRIGGER that enables RLS on any table
-- created in the public schema. Creating event triggers requires superuser,
-- so it is not reproducible from this file — it is managed by Supabase or was
-- applied out of band. Leave it in place; it is the safety net that would
-- have caught bookings_archive.


-- ============================================================
-- 11. POST-INSTALL: backfill created_at (run once, optional)
-- ============================================================
-- Not run automatically — it rewrites a column on every row. Run it once,
-- then verify. The upper bound is now(): a real creation time cannot be in
-- the future, which is what separates genuine ids from legacy ones.
--
--   alter table public.bookings alter column created_at drop default;
--   update public.bookings set created_at = null where created_at is not null;
--   update public.bookings
--   set created_at = to_timestamp(
--         public.base36_to_bigint(substring(booking_id from 2 for 8)) / 1000.0)
--   where booking_id ~ '^b[0-9a-z]{8}'
--     and public.base36_to_bigint(substring(booking_id from 2 for 8))
--         between 1704067200000
--             and (extract(epoch from now()) * 1000)::bigint + 86400000;
--   alter table public.bookings alter column created_at set default now();


-- ============================================================
-- 12. VERIFY
-- ============================================================
-- Every table in public must have RLS on. Expect zero rows:
--
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
--
-- What anon can execute. Expect true ONLY for base36_to_bigint,
-- cancel_own_booking, release_own_booking, check_login_rate_limit,
-- log_failed_login:
--
--   select p.proname, p.prosecdef as security_definer,
--          has_function_privilege('anon', p.oid, 'execute') as anon_can_call
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--   order by anon_can_call desc, p.proname;
--
-- Every SECURITY DEFINER function must name pg_temp. Expect zero rows:
--
--   select p.proname, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and not coalesce(array_to_string(p.proconfig, ',') like '%pg_temp%', false);
--
-- No admin policy may be unconditional. Expect zero rows:
--
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'bookings'
--     and policyname like 'Admins%'
--     and (qual = 'true' or with_check = 'true');
--
-- Views in public bypass RLS unless security_invoker is set. Anything
-- returned here needs `with (security_invoker = true)`:
--
--   select c.relname, c.reloptions from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'v';


-- ============================================================
-- 13. OPEN ITEMS — reviewed, not yet applied
-- ============================================================
-- Recorded here so they are not rediscovered from scratch. None are
-- exploitable as they stand. Applying any of them means changing the live
-- database AND this file in the same sitting.
--
-- b) enforce_room_capacity is SECURITY INVOKER, so its internal reads are
--    subject to RLS. It works today only because "Public can view bookings"
--    returns every row. If that SELECT policy is ever tightened — a likely
--    response to the booked_by exposure noted in section 2 — the capacity
--    check starts counting a filtered subset and silently permits
--    overbooking. No error, no log. Making it SECURITY DEFINER decouples it.
--
-- c) base36_to_bigint has no length guard. It is anon-callable and multiplies
--    without bound, so a long input raises a bigint overflow instead of
--    returning null the way a bad character does. No security impact, but it
--    is an unhandled exception reachable by anyone. Return null above ~12
--    characters.
--
-- d) The app still derives creation time by decoding booking ids
--    (js/utils/ids.js creationMs) rather than reading created_at, which now
--    exists and is backfilled. Switching over is a small change in
--    supabase-client.js and filters-sort.js, after which creationMs can go.
