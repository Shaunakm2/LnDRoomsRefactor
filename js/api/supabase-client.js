// js/api/supabase-client.js
// Client init + the one function that loads all booking data. Everything
// else in api/ assumes `supabase` (exported here) is already initialized.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
import { setBookings } from '../state.js';
import { toast, showLoadingOverlay } from '../utils/dom-helpers.js';

// `window.supabase` here is the global injected by the Supabase JS SDK
// script tag in index.html. Exported so api/bookings.js, api/auth.js etc.
// can import and reuse the same client instance rather than each creating
// their own.
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let _writeCompletedAt = 0;
export function markWriteCompleted() { _writeCompletedAt = Date.now(); }

// Prevent a silent background refresh from wiping out an optimistic local
// update before the database write has actually landed.
function writeRecentlyCompleted() {
  return (Date.now() - _writeCompletedAt) < 3000;
}

export async function loadData(silent = false) {
  if (silent && writeRecentlyCompleted()) return;
  try {
    if (!silent) showLoadingOverlay(true);
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      // Most relevant/recent dates first, so if the row cap below is ever
      // hit again, today's and future bookings are prioritized over old
      // history rather than silently missing.
      .order('booking_date', { ascending: false })
      // Supabase/PostgREST defaults to a silent 1000-row cap on unpaginated
      // selects — that was a real bug found earlier: today's bookings
      // simply weren't in the first 1000 rows returned, and the app showed
      // an empty schedule with no error. This explicitly requests up to
      // 5000. (Also requires "Max Rows" raised in the Supabase dashboard —
      // this alone is necessary but not sufficient.)
      .range(0, 4999);

    if (error) throw error;
    const mapped = (data || []).map(r => ({
      id: String(r.booking_id || '').trim(),
      room: String(r.room || '').trim(),
      booker: String(r.booked_by || '').trim(),
      purpose: String(r.purpose || '').trim(),
      date: String(r.booking_date || '').trim(),
      start: String(r.start_time || '00:00:00').trim().substring(0, 5),
      end: String(r.end_time || '00:00:00').trim().substring(0, 5),
      attendees: r.attendees != null ? String(r.attendees) : '',
      status: String(r.status || 'Confirmed').trim(),
      endDate: String(r.end_date || '').trim(),
      conflictResolved: !!r.conflict_resolved,
      conflictNote: String(r.conflict_note || '').trim()
    }));
    // Sort by creation time, embedded in the booking id itself.
    mapped.sort((a, b) => {
      const ta = a.id || '';
      const tb = b.id || '';
      return tb > ta ? 1 : (tb < ta ? -1 : 0); // newest created first
    });
    setBookings(mapped);
  } catch (e) {
    console.error('Load error', e);
    setBookings([]);
    toast('Could not load bookings. Check connection.', true);
  } finally {
    if (!silent) showLoadingOverlay(false);
  }
}
