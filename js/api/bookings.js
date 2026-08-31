// js/api/bookings.js
// Every function here does exactly one thing: talk to Supabase for a
// specific booking mutation, throw on error, mark the write-debounce
// timestamp on success. UI-layer code (ui/*.js) is responsible for the
// optimistic local update + rollback-on-failure pattern around these calls.

import { supabase, markWriteCompleted } from './supabase-client.js';
import { isOvernight, addDaysStr } from '../domain/time.js';

export async function apiCreate(b) {
  const endDate = b.endDate || (isOvernight(b) ? addDaysStr(b.date, 1) : b.date);
  const { error } = await supabase.from('bookings').insert({
    booking_id: b.id, room: b.room, booked_by: b.booker, purpose: b.purpose || '',
    booking_date: b.date, start_time: b.start, end_time: b.end,
    attendees: b.attendees || null, status: b.status || 'Confirmed', end_date: endDate
  });
  if (error) throw error;
  markWriteCompleted();
}

export async function apiUpdateStatus(id, status) {
  const { error } = await supabase.from('bookings').update({ status }).eq('booking_id', id);
  if (error) throw error;
  markWriteCompleted();
}

export async function apiSetConflictResolved(id, resolved, note) {
  const { error } = await supabase.from('bookings')
    .update({ conflict_resolved: !!resolved, conflict_note: note || '' })
    .eq('booking_id', id);
  if (error) throw error;
  markWriteCompleted();
}

// Batch variants — used for recurring bookings and bulk admin actions. A
// single insert/update call for the whole batch.
export async function apiCreateRequestBatch(bookingsArr) {
  const rows = bookingsArr.map(b => {
    const endDate = b.endDate || (isOvernight(b) ? addDaysStr(b.date, 1) : b.date);
    return {
      booking_id: b.id, room: b.room, booked_by: b.booker, purpose: b.purpose || '',
      booking_date: b.date, start_time: b.start, end_time: b.end,
      attendees: b.attendees || null, status: 'Pending', end_date: endDate
    };
  });
  const { error } = await supabase.from('bookings').insert(rows);
  if (error) throw error;
  markWriteCompleted();
}

export async function apiUpdateStatusBatch(ids, status) {
  const { error } = await supabase.from('bookings').update({ status }).in('booking_id', ids);
  if (error) throw error;
  markWriteCompleted();
}

export async function apiUpdate(b) {
  // Postgres updates are transactional and immediate — a single UPDATE,
  // no delete-then-recreate dance.
  const endDate = b.endDate || (isOvernight(b) ? addDaysStr(b.date, 1) : b.date);
  const { error } = await supabase.from('bookings').update({
    room: b.room, booked_by: b.booker, purpose: b.purpose || '',
    booking_date: b.date, start_time: b.start, end_time: b.end,
    attendees: b.attendees || null, status: b.status || 'Confirmed', end_date: endDate,
    conflict_resolved: !!b.conflictResolved, conflict_note: b.conflictNote || ''
  }).eq('booking_id', b.id);
  if (error) throw error;
  markWriteCompleted();
}

export async function apiDelete(id) {
  const { error } = await supabase.from('bookings').delete().eq('booking_id', id);
  if (error) throw error;
  markWriteCompleted();
}

// Public self-service actions. These call SECURITY DEFINER Postgres
// functions that re-verify the name match server-side (see
// supabase/schema.sql) — the anon key alone cannot cancel/edit someone
// else's booking even if a client-side check were bypassed.
export async function apiCancelOwn(id, bookerName) {
  const { data, error } = await supabase.rpc('cancel_own_booking', {
    p_booking_id: id, p_booker_name: bookerName
  });
  if (error) throw error;
  if (!data.ok) throw new Error(data.error);
  markWriteCompleted();
}

export async function apiReleaseOwn(id, bookerName, endTime, endDate) {
  const { data, error } = await supabase.rpc('release_own_booking', {
    p_booking_id: id, p_booker_name: bookerName, p_end_time: endTime, p_end_date: endDate
  });
  if (error) throw error;
  if (!data.ok) throw new Error(data.error);
  markWriteCompleted();
}
