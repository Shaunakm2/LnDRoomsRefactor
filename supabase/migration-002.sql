-- migration-002.sql
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once. Nothing here touches booking data.

-- ============================================================
-- 1. FIX: login rate limiter is global, not per-client
-- ============================================================
-- check_login_rate_limit() counted EVERY row in login_attempt_log inside the
-- window, with no client identity in the WHERE clause. Ten attempts from
-- anyone in five minutes therefore locked out everyone, including the admin
-- with the correct password. It also logged successful attempts, so normal
-- use counted toward the limit.
--
-- This version partitions by client IP and only logs failures. The caller
-- (js/api/auth.js) is unchanged: it still calls check_login_rate_limit()
-- before attempting sign-in, and now calls log_failed_login() after a
-- failure.

alter table public.login_attempt_log
  add column if not exists ip inet;

create index if not exists login_attempt_log_ip_time_idx
  on public.login_attempt_log (ip, created_at desc);

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

  -- Scoped to this client. NOTE: behind Supabase's connection pooler
  -- inet_client_addr() may report the gateway rather than the true client.
  -- If that turns out to be the case here, every request looks like one IP
  -- and the limit behaves globally again — verify with:
  --   select inet_client_addr();
  -- If it returns the same address from different networks, switch the
  -- partition key to something the client supplies instead.
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

  -- Deliberately does NOT insert here. Only failed attempts are logged, by
  -- log_failed_login() below, so successful logins don't consume the budget.
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

grant execute on function public.check_login_rate_limit() to anon, authenticated;
grant execute on function public.log_failed_login()       to anon, authenticated;

-- Clear the backlog accumulated under the old global counter.
delete from public.login_attempt_log;

-- ============================================================
-- 2. ADD: real creation timestamp on bookings
-- ============================================================
-- "Recently Added" had to infer creation time by decoding the base36
-- timestamp out of booking_id. That broke because legacy rows have ids with
-- no 'b' prefix ('z5darnfgby11...'), which sort above every app-created id.
-- js/utils/ids.js works around it, but a real column is the correct fix.

alter table public.bookings
  add column if not exists created_at timestamptz not null default now();

-- Backfill rows whose id encodes its creation time: 'b' + 8 base36 chars.
-- Postgres has no base36 parser, so this converts digit by digit.
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
    v_char := lower(substring(p_text from i for 1));
    v_digit := position(v_char in '0123456789abcdefghijklmnopqrstuvwxyz') - 1;
    if v_digit < 0 then
      return null;
    end if;
    v_result := v_result * 36 + v_digit;
  end loop;
  return v_result;
end;
$$;

-- CORRECTED BOUNDS. The first version of this migration allowed decoded
-- values up to 4000000000000 (year 2096) and produced created_at dates in
-- 2055-2059 for legacy rows. Those rows also begin with 'b' followed by 8
-- base36 chars, but the chars are not a timestamp — verified against live
-- data: 'bzxt8e8j3...' decodes to 2059-03-31. A real creation time cannot be
-- in the future, so the upper bound is now(). Rows failing the check are left
-- NULL rather than defaulted to now(), because defaulting them would make the
-- oldest rows look like the newest.
alter table public.bookings alter column created_at drop not null;
alter table public.bookings alter column created_at drop default;

update public.bookings set created_at = null;

update public.bookings
set created_at = to_timestamp(public.base36_to_bigint(substring(booking_id from 2 for 8)) / 1000.0)
where booking_id ~ '^b[0-9a-z]{8}'
  and public.base36_to_bigint(substring(booking_id from 2 for 8))
      between 1704067200000                                      -- 2024-01-01
          and (extract(epoch from now()) * 1000)::bigint + 86400000;

-- New rows get a real timestamp from here on.
alter table public.bookings alter column created_at set default now();

-- Legacy rows are left with created_at = NULL: their real creation time is
-- not recorded anywhere and cannot be recovered. Sort them as oldest (in
-- Postgres, `order by created_at desc nulls last`). Check the result:
--   select booking_id, booking_date, created_at from public.bookings
--   order by created_at desc limit 20;

-- ============================================================
-- AFTER RUNNING THIS
-- ============================================================
-- The app does not yet read created_at — js/utils/ids.js still decodes the
-- id, which now works correctly. Once you've confirmed the backfill looks
-- right, switching the sort to created_at is a small change in
-- js/api/supabase-client.js (select it, map it) and js/domain/filters-sort.js
-- (use it instead of creationMs), after which creationMs can be deleted.
