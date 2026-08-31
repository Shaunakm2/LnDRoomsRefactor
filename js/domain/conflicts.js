// js/domain/conflicts.js
// Conflicts are deliberately NEVER stored — they're recalculated live every
// time something renders, so a warning always matches current reality and
// disappears automatically once the conflicting booking is deleted/cancelled,
// instead of being frozen as stale text.

import { bookings } from '../state.js';
import { bookingSpans } from './time.js';
import { fmtTime, fmtDate } from '../utils/formatting.js';
import { ROOMS } from '../config.js';
// Returns EVERY overlapping booking for this room/date/time, not just the
// first one found — a single slot can have more than one conflicting
// request (e.g. two different pending requests both overlapping the same
// confirmed booking).
export function findAllConflicts(room, date, start, end, excludeId) {
  const newSpans = bookingSpans({ date, start, end });
  const found = [];
  for (const b of bookings) {
    if (b.room !== room) continue;
    if (excludeId && b.id === excludeId) continue;
    if (b.status === 'Rejected' || b.status === 'Cancelled') continue;
    let overlaps = false;
    for (const ex of bookingSpans(b)) {
      for (const ns of newSpans) {
        if (ex.date === ns.date && ns.start < ex.end && ns.end > ex.start) { overlaps = true; break; }
      }
      if (overlaps) break;
    }
    if (overlaps) found.push(b);
  }
  return found;
}

export function findConflict(room, date, start, end, excludeId) {
  return findAllConflicts(room, date, start, end, excludeId)[0] || null;
}

// Computes conflicts for an EXISTING booking, live, against current data —
// used by admin views so the warning is always accurate right now.
export function getLiveConflicts(b) {
  return findAllConflicts(b.room, b.date, b.start, b.end, b.id);
}

export function describeConflict(c) {
  const isPending = c.status === 'Pending';
  const statusLabel = isPending ? 'a pending request' : 'a confirmed booking';
  return `${statusLabel} ${fmtTime(c.start)}–${fmtTime(c.end)} by ${c.booker} on ${fmtDate(c.date)}`;
}

export function formatLiveConflictNote(conflicts) {
  if (conflicts.length === 0) return '';
  if (conflicts.length === 1) return `⚠️ Overlap: ${describeConflict(conflicts[0])}`;
  return `⚠️ ${conflicts.length} overlaps: ` + conflicts.map(describeConflict).join('; ');
}
export function getFreeRoomsForDate(date, start, end, excludeRoom) {
  return ROOMS.filter(r => {
    if (r.id === excludeRoom) return false;
    return !findConflict(r.id, date, start, end, null);
  });
}
