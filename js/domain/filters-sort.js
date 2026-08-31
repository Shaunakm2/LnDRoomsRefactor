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

  // ---- Sorting ----
  // Every dropdown option must do exactly what its label says.
  // Sort keys are precomputed once per booking rather than derived inside
  // the comparator: the "Soonest" ordering needs bookingTimeStatus(), which
  // expands each booking's spans, and a comparator runs O(n log n) times.
  const keyed = filtered.map(b => ({
    b,
    dateKey: (b.date || '') + (b.start || '00:00'),
    isPast: bookingTimeStatus(b) === 'past',
    roomKey: roomName(b.room).toLowerCase(),
    statusKey: (b.status || '').toLowerCase(),
    idKey: b.id || ''
  }));

  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const dir = sortDir === 'asc' ? 1 : -1;

  if (sortField === 'bookingdate' && sortDir === 'asc') {
    // "Booking Date (Soonest)" — the next booking that hasn't happened yet
    // sits at the top. A plain ascending date sort would instead surface the
    // oldest row in the table, which is not what "soonest" means. Anything
    // already finished drops below, most-recent-first, so the list reads as
    // distance from now in both directions. In-progress bookings count as
    // upcoming, since they are the soonest thing there is.
    keyed.sort((x, y) => {
      if (x.isPast !== y.isPast) return x.isPast ? 1 : -1;
      return x.isPast ? cmp(y.dateKey, x.dateKey) : cmp(x.dateKey, y.dateKey);
    });
  } else {
    keyed.sort((x, y) => {
      // Direction applies to the labelled column only. Ties break on date
      // ascending so equal rows land in a stable, readable order rather
      // than whatever order they happened to load in.
      if (sortField === 'room')   return dir * cmp(x.roomKey, y.roomKey)     || cmp(x.dateKey, y.dateKey);
      if (sortField === 'status') return dir * cmp(x.statusKey, y.statusKey) || cmp(x.dateKey, y.dateKey);
      // 'bookingdate' desc = "Latest": furthest-future booking first.
      if (sortField === 'bookingdate') return dir * cmp(x.dateKey, y.dateKey);
      // Creation time, encoded in the booking id as 'b' + base36 timestamp
      // + random suffix. IMPORTANT: compare as a STRING, not parseInt(id) —
      // the timestamp portion contains letters (base36), so parseInt with no
      // radix fails on the first letter and returns NaN -> 0 for every row,
      // which made this sort a silent no-op in an earlier version. String
      // comparison works because every id has the same fixed-width
      // structure, so lexicographic order matches chronological order.
      return dir * cmp(x.idKey, y.idKey);
    });
  }

  return keyed.map(k => k.b);
}
