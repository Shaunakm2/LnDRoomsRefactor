// js/state.js
// All the app's mutable state lives here. Every screen (room cards, admin
// table, timeline) is just a different view over the one `bookings` array.
//
// IMPORTANT ES MODULE GOTCHA — read before touching this file:
// `export let bookings` gives other modules a LIVE, read-only view — if
// THIS file reassigns `bookings = [...]`, every module that imported it
// sees the new value automatically. But another module can NEVER do
// `bookings = something` directly (import bindings are read-only from the
// consumer's side) — it must call setBookings(arr) instead.
// In-place mutation (bookings.push(x), bookings[i] = x) works fine from
// anywhere without needing a setter, since that mutates the same array
// object rather than replacing which object `bookings` points to.

export let bookings = [];
export function setBookings(arr) { bookings = arr; }

export let adminLoggedIn = false;
export function setAdminLoggedIn(v) { adminLoggedIn = v; }

export let sessionToken = null; // issued by server on login, required for all admin writes
export function setSessionToken(v) { sessionToken = v; }

export let deleteTargetId = null;
export function setDeleteTargetId(v) { deleteTargetId = v; }

export let timelineDay = 'today';
export function setTimelineDay(v) { timelineDay = v; }

// Admin table pagination/sort
export let tablePage = 0;
export function setTablePage(v) { tablePage = v; }
export let tablePageLocked = false;
export function setTablePageLocked(v) { tablePageLocked = v; }
export let sortField = 'bookingdate'; // 'bookingdate' | 'datetime' | 'room' | 'booker' | 'status'
export function setSortField(v) { sortField = v; }
export let sortDir = 'asc'; // 'asc' | 'desc'
export function setSortDir(v) { sortDir = v; }

// Login rate-limit UI feedback (real enforcement is server-side — see
// api/auth.js calling the check_login_rate_limit RPC; these are just for
// instant client-side messaging, not the actual security boundary)
export let loginAttempts = 0;
export function setLoginAttempts(v) { loginAttempts = v; }
export let loginLockedUntil = 0;
export function setLoginLockedUntil(v) { loginLockedUntil = v; }
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

// Session timeout — 30 min inactivity
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_WARNING_MS = 5 * 60 * 1000; // warn 5 min before actual timeout
export let lastActivityAt = Date.now();
export function setLastActivityAt(v) { lastActivityAt = v; }
export let sessionWarningShown = false;
export function setSessionWarningShown(v) { sessionWarningShown = v; }
