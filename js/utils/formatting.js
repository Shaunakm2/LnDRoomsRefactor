// js/utils/formatting.js
// Pure display-formatting functions. No dependency on `bookings`, DOM, or
// any other module's state — safe to import anywhere, safe to unit-test
// in isolation.

import { parseTimeToMins } from '../domain/time.js';

export function pad(n) { return String(n).padStart(2, '0'); }

export function fmtDate(ds) {
  const [y, m, d] = ds.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${names[parseInt(m) - 1]} ${y}`;
}

export function fmtTime(ts) {
  if (!ts) return '—';
  ts = String(ts).trim();
  if (!ts || ts === 'undefined') return '—';
  const mins = parseTimeToMins(ts);
  if (mins === null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${pad(m)} ${ap}`;
}

// Strips legacy conflict notes that older versions of this app baked directly
// into the Purpose field (before conflict detection became live-computed at
// render time). Old format always ends the string with "[⚠️ Overlap: ...]" or
// "[⚠️ N overlaps: ...]". Only affects DISPLAY — never touches stored data.
export function displayPurpose(purpose) {
  if (!purpose) return purpose;
  return purpose.replace(/\s*\[⚠️[^\]]*\]\s*$/, '');
}
