// js/domain/room-status.js
// Determines whether a room is free/occupied/ending-soon right now, and
// what's coming up next. The trickiest part: a room can legitimately have
// MORE THAN ONE active booking at once (an admin resolved a conflict and
// let two people share it) — an earlier version of this only found the
// FIRST active booking and stopped, silently hiding the second occupant.
// activeEntries below deliberately collects ALL of them.

import { bookings } from '../state.js';
import { todayStr, nowMinutes, minutesSinceMidnight, addDaysStr, bookingSpans } from './time.js';

// Elapsed/total minutes if this booking is active right now, else null.
export function activeSpanInfo(b) {
  const today = todayStr();
  const now = nowMinutes();
  const s = minutesSinceMidnight(b.start), e = minutesSinceMidnight(b.end);
  const overnight = e <= s;
  const total = overnight ? (1440 - s + e) : (e - s);
  if (total <= 0) return null;
  if (!overnight) {
    if (b.date === today && now >= s && now < e) return { elapsed: now - s, total };
    return null;
  }
  if (b.date === today && now >= s) return { elapsed: now - s, total };
  if (addDaysStr(b.date, 1) === today && now < e) return { elapsed: (1440 - s) + now, total };
  return null;
}

export function getRoomStatus(roomId) {
  const today = todayStr();
  const now = nowMinutes();
  const relevant = bookings.filter(b => b.room === roomId && (b.status === 'Confirmed' || !b.status));

  const activeEntries = [];
  for (const b of relevant) {
    const info = activeSpanInfo(b);
    if (info) activeEntries.push({ booking: b, info });
  }
  const activeBookings = activeEntries.map(e => e.booking);

  const upcomingToday = relevant
    .filter(b => !activeBookings.includes(b))
    .map(b => {
      const sp = bookingSpans(b).find(s => s.date === today && s.start > now);
      return sp ? { b, start: sp.start } : null;
    })
    .filter(Boolean)
    .sort((a, c) => a.start - c.start)
    .map(x => x.b);

  if (activeEntries.length > 0) {
    // Soonest-ending booking first, so the card's headline status reflects
    // whichever occupant is leaving next.
    activeEntries.sort((a, c) => (a.info.total - a.info.elapsed) - (c.info.total - c.info.elapsed));
    const soonestRemaining = activeEntries[0].info.total - activeEntries[0].info.elapsed;
    return {
      status: soonestRemaining <= 30 ? 'soon' : 'occupied',
      activeEntries,
      nextBookings: upcomingToday
    };
  }

  return {
    status: 'free',
    activeEntries: [],
    nextBookings: upcomingToday.slice(0, 1)
  };
}
