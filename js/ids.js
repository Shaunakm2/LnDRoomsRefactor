// js/utils/ids.js
// Booking IDs are 'b' + creation-time-in-base36 + random suffix. Because
// every id has this same fixed-width structure, plain string comparison
// sorts them chronologically — used by domain/filters-sort.js's
// "Recently Added" sort without needing to parse anything out.

export function genId() {
  const ts = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
  return 'b' + ts + rand;
}
