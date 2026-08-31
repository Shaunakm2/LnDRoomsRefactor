-- ============================================================
-- Room Booking App — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. BOOKINGS TABLE ------------------------------------------------
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
  conflict_note     text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_bookings_date on public.bookings (booking_date);
create index if not exists idx_bookings_room_date on public.bookings (room, booking_date);
create index if not exists idx_bookings_status on public.bookings (status);

-- 2. ROW LEVEL SECURITY --------------------------------------------
alter table public.bookings enable row level security;

-- Anyone (anon key, i.e. the public status board) can read all bookings.
create policy "Public can view bookings"
  on public.bookings for select
  using (true);

-- Anyone can create a booking REQUEST, but it must land as Pending.
-- (Confirmed bookings are only ever created by a logged-in admin.)
create policy "Public can create pending requests"
  on public.bookings for insert
  with check (
    status = 'Pending'
    and conflict_resolved = false
    and (conflict_note is null or conflict_note = '')
  );

-- Only logged-in admins (Supabase Auth session) can insert Confirmed bookings,
-- update anything, or delete anything.
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

-- 3. SELF-SERVICE CANCELLATION (secure RPC) -------------------------
-- The public "Cancel My Booking" flow lets a non-admin cancel their own
-- booking by typing their name. We do NOT trust the client to verify the
-- name match (that used to happen only in JS) — this function re-checks
-- it server-side with SECURITY DEFINER, bypassing RLS safely, and is the
-- ONLY way an anonymous caller can change a row's status.
create or replace function public.cancel_own_booking(p_booking_id text, p_booker_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.bookings;
begin
  select * into v_row from public.bookings where booking_id = p_booking_id;

  if v_row is null then
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

-- Allow anon + authenticated to call the RPC (the function itself does the
-- real authorization check above — this grant just lets the call through).
grant execute on function public.cancel_own_booking(text, text) to anon, authenticated;

-- 4. ARCHIVE TABLE (optional, mirrors the old Google Sheet "Archive" tab) --
create table if not exists public.bookings_archive (like public.bookings including all);

-- Moves bookings older than N days (default 90) to the archive table.
-- Call manually, or schedule with pg_cron (see README).
create or replace function public.archive_old_bookings(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
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

-- 5. REALTIME (optional but recommended) -----------------------------
-- Lets the frontend subscribe to live changes instead of polling.
alter publication supabase_realtime add table public.bookings;

-- 6. RATE LIMITING -----------------------------------------------------
-- Applied live via SQL Editor earlier; added here so this file matches
-- the actual deployed database (was previously undocumented drift).
-- Limits: 5 booking inserts/min for authenticated admin, 2/min for
-- anonymous public requests (keyed by the name typed into the form —
-- not spoof-proof, but deters accidental spam/double-submits).
create table if not exists public.booking_rate_log (
  id         bigint generated always as identity primary key,
  actor      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_log_actor_time
  on public.booking_rate_log (actor, created_at);
alter table public.booking_rate_log enable row level security;
-- No policies granted to anon/authenticated — only the SECURITY DEFINER
-- trigger below touches this table.

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

-- 7. ROOM CAPACITY ENFORCEMENT ------------------------------------------
-- Applied live via SQL Editor earlier; added here for the same reason
-- as section 6 — matches per-room seat counts used in app.js's ROOMS
-- array (Chanakya 45, 2nd Floor Conference Room 5, all others 30).
create or replace function public.enforce_room_capacity()
returns trigger language plpgsql as $$
declare
  v_cap integer;
begin
  v_cap := case new.room
    when 'chanakya' then 45
    when 'conf2f' then 5
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
  for each row execute function public.enforce_room_capacity();

-- 8. LOGIN RATE LIMITING -------------------------------------------------
-- Fix for #11: the app previously only had a CLIENT-SIDE attempt counter
-- (plain JS variables) — trivially bypassed by refreshing the page or
-- calling supabase.auth.signInWithPassword() directly. This moves real
-- enforcement server-side, same pattern as the booking rate limiter above.
--
-- Note: Supabase's own dashboard "Rate limit for sign-ups and sign-ins"
-- setting is currently unreliably enforced (known issue, not fixed by
-- Supabase as of this writing) — don't rely on that alone. Also worth
-- turning it on anyway as free defense-in-depth, it just isn't sufficient
-- by itself.
--
-- Honest limitation: this gates the login attempt made THROUGH THIS APP's
-- own UI flow. It does not and cannot block someone who bypasses app.js
-- entirely and calls Supabase's raw Auth API directly with your anon key
-- and the admin email — that would need Cloudflare/WAF-style protection
-- in front of the whole domain, which was explicitly declined for now.
-- This is a disclosed, accepted tradeoff, same as the cancel/release
-- name-verification gap documented above.

create table if not exists public.login_attempt_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
alter table public.login_attempt_log enable row level security;
-- No policies granted to anon/authenticated — only the SECURITY DEFINER
-- function below touches this table.

create or replace function public.check_login_rate_limit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_cnt   integer;
  v_limit        integer := 10;                 -- max attempts per window
  v_window       interval := interval '5 minutes';
  v_oldest       timestamptz;
begin
  delete from public.login_attempt_log where created_at < now() - interval '30 minutes';

  select count(*), min(created_at) into v_recent_cnt, v_oldest
  from public.login_attempt_log
  where created_at > now() - v_window;

  if v_recent_cnt >= v_limit then
    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds', greatest(1, extract(epoch from (v_oldest + v_window - now()))::int)
    );
  end if;

  insert into public.login_attempt_log default values;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.check_login_rate_limit() to anon, authenticated;
