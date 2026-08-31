// js/domain/filters-sort.js
// Search/filter/sort logic for the admin "All Bookings" table. Reads its
// filter values straight from the DOM (search box, dropdowns) rather than
// taking them as parameters — matches how the rest of the UI layer works
// in this app (DOM is the source of truth for filter state, not a separate
// filter-state object).

import { bookings, sortField, sortDir } from '../state.js';
import { todayStr, bookingSpans, nowMinutes } from './time.js';
import { roomName } from '../config.js';
import { getLiveConflicts } from './conflicts.js';

// 'active' | 'past' | 'upcoming' relative to now, handling overnight spans
export function bookingTimeStatus(b) {
  const today = todayStr();
  const now = nowMinutes();
  const spans = bookingSpans(b);
  for (const sp of spans) {
    if (sp.date === today && now >= sp.start && now < sp.end) return 'active';
  }
  const last = spans[spans.length - 1];
  if (last.date < today || (last.date === today && last.end <= now)) return 'past';
  return 'upcoming';
}

export function getFilteredBookings() {
  const search = document.getElementById('search-input').value.toLowerCase().trim();
  const filterRoom = document.getElementById('filter-room').value;
  const filterDate = document.getElementById('filter-date').value;
  const conflictsOnly = document.getElementById('filter-conflicts-only')?.checked;
  const today = todayStr();

  let filtered = [...bookings];
  if (conflictsOnly) filtered = filtered.filter(b => (b.status === 'Pending' || b.status === 'Confirmed') && getLiveConflicts(b).length > 0);
  if (search) {
    filtered = filtered.filter(b =>
      b.booker.toLowerCase().includes(search) ||
      b.room.toLowerCase().includes(search) ||
      roomName(b.room).toLowerCase().includes(search) ||
      (b.purpose || '').toLowerCase().includes(search)
    );
  }
  if (filterRoom) filtered = filtered.filter(b => b.room === filterRoom);
  if (filterDate === 'today') filtered = filtered.filter(b => b.date === today);
  else if (filterDate === 'upcoming') filtered = filtered.filter(b => bookingTimeStatus(b) !== 'past');
  else if (filterDate === 'past') filtered = filtered.filter(b => bookingTimeStatus(b) === 'past');

  filtered.sort((a, b) => {
    let va, vb;
    if (sortField === 'bookingdate') {
      va = a.date + (a.start || '00:00');
      vb = b.date + (b.start || '00:00');
    } else if (sortField === 'room') {
      va = roomName(a.room).toLowerCase();
      vb = roomName(b.room).toLowerCase();
    } else if (sortField === 'status') {
      va = (a.status || '').toLowerCase();
      vb = (b.status || '').toLowerCase();
    } else {
      // Creation time, encoded in the booking id as 'b' + base36 timestamp
      // + random suffix. IMPORTANT: compare as a STRING, not parseInt(id) —
      // the timestamp portion contains letters (base36), so parseInt with
      // no radix fails immediately on the first letter, returning NaN -> 0
      // for every row. That made an earlier version of this sort a
      // complete no-op (every row got the same key). String comparison
      // works because every id has the same fixed-width structure, so
      // lexicographic order exactly matches chronological order.
      va = a.id || '';
      vb = b.id || '';
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return filtered;
}
