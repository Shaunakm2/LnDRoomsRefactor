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

create policy "Admins can insert any booking"
  on public.bookings for insert
  to authenticated
  with check (true);

create policy "Admins can update bookings"
  on public.bookings for update
  to authenticated
  using (true)
  with check (true);

create policy "Admins can delete bookings"
  on public.bookings for delete
  to authenticated
  using (true);


-- ============================================================
-- 3. SELF-SERVICE CANCEL / RELEASE (SECURITY DEFINER RPCs)
-- ============================================================
-- These are the ONLY way an anonymous caller can modify a row. Both run as
-- the owner and bypass RLS, so their internal checks ARE the security
-- boundary — the client-side name check in cancel-release.js is a UX nicety.
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
set search_path = public
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
set search_path = public
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
alter table public.bookings_archive enable row level security;

create or replace function public.archive_old_bookings(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
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
-- No policies: only the SECURITY DEFINER trigger below touches this table.

create or replace function public.enforce_booking_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
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
-- No policies: only the SECURITY DEFINER functions below touch this table.

create or replace function public.check_login_rate_limit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_cnt integer;
  v_limit      integer  := 10;
  v_window     interval := interval '5 minutes';
  v_oldest     timestamptz;
  v_ip         inet     := inet_client_addr();
begin
  delete from public.login_attempt_log where created_at < now() - interval '30 minutes';

  -- VERIFY THIS ON YOUR PROJECT: behind Supabase's connection pooler,
  -- inet_client_addr() may report the pooler rather than the real client. If
  -- `select inet_client_addr();` returns the same address from different
  -- networks, this partition is ineffective and the limit is global again.
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
set search_path = public
as $$
begin
  insert into public.login_attempt_log (ip) values (inet_client_addr());
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
