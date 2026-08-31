// js/domain/time.js
// Date/time math. Deliberately avoids JS Date objects for anything
// date-arithmetic (only used for display formatting) to sidestep timezone
// shift bugs — see localDateStr() below.

export function todayStr() {
  return localDateStr(new Date());
}

export function localDateStr(d) {
  // Always uses local time, never UTC — fixes GMT+5:30 timezone shift bugs
  // that new Date('YYYY-MM-DD') parsing can silently introduce.
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function parseTimeToMins(ts) {
  if (!ts) return null;
  ts = String(ts).trim();
  // "H:MM AM/PM" or "H:MM:SS AM/PM"
  const ampm = ts.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return h * 60 + m;
  }
  // "HH:MM" or "HH:MM:SS" 24hr
  const hhmm = ts.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) return parseInt(hhmm[1]) * 60 + parseInt(hhmm[2]);
  // Fraction of day (legacy Google Sheets serial format)
  const num = parseFloat(ts);
  if (!isNaN(num) && num > 0 && num < 1) return Math.round(num * 24 * 60);
  return null;
}

export function minutesSinceMidnight(ts) {
  const mins = parseTimeToMins(ts);
  return mins !== null ? mins : 0;
}

export function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export function addDaysStr(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localDateStr(dt);
}

export function isOvernight(b) {
  return minutesSinceMidnight(b.end) < minutesSinceMidnight(b.start);
}

// Splits a booking into 1 or 2 {date, start, end} minute-spans, handling
// midnight crossover. Every other date/time-aware piece of logic in the
// app (conflict detection, the timeline, the schedule modal, "is this
// room busy right now") loops over this function's output rather than
// the raw start/end fields — overnight handling only had to be solved
// correctly once, here.
export function bookingSpans(b) {
  const s = minutesSinceMidnight(b.start);
  const e = minutesSinceMidnight(b.end);
  if (e > s) return [{ date: b.date, start: s, end: e }];
  const spans = [{ date: b.date, start: s, end: 1440 }];
  if (e > 0) spans.push({ date: addDaysStr(b.date, 1), start: 0, end: e });
  return spans;
}

// ============================================================

export function getWeekdays(startStr, endStr) {
  const dates = [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (end < start) return dates;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(localDateStr(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
