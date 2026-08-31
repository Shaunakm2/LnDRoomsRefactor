// js/ui/request-form.js
// Public "Request a Booking" modal. Conflicts are checked BEFORE anything
// is submitted — if any day in a recurring range conflicts, this hands off
// to the conflict-picker (public/Pending mode) instead of submitting
// everything blind with just a warning note afterward.

import { ROOMS, roomName } from '../config.js';
import { bookings } from '../state.js';
import { todayStr, minutesSinceMidnight, addDaysStr, getWeekdays } from '../domain/time.js';
import { fmtTime, fmtDate } from '../utils/formatting.js';
import { showLoadingOverlay } from '../utils/dom-helpers.js';
import { genId } from '../utils/ids.js';
import { findAllConflicts } from '../domain/conflicts.js';
import { loadData } from '../api/supabase-client.js';
import { apiCreateRequestBatch } from '../api/bookings.js';
import { notifyTeams } from '../api/notifications.js';
import { roomBadgesHtml } from './status-grid.js';
import { openConflictModal } from './conflict-picker.js';
import { launchConfetti } from './effects.js';
import { updatePendingDot } from './pending-list.js';

let reqSubmitting = false;
let _reqOpenedAt = 0; // bot-deterrence: timestamp when the request modal opened

export function toggleReqRecurring() {
  const isRecurring = document.getElementById('req-recurring').checked;
  document.getElementById('req-recurring-end-wrap').style.display = isRecurring ? 'block' : 'none';
  if (isRecurring) {
    const startDate = document.getElementById('req-date').value;
    if (startDate) document.getElementById('req-date-end').value = startDate;
  }
}

export function updateReqCapacityHint() {
  const roomId = document.getElementById('req-room').value;
  const hint = document.getElementById('req-capacity-hint');
  if (!hint) return;
  const room = ROOMS.find(r => r.id === roomId);
  if (room && room.capacity) {
    hint.innerHTML = roomBadgesHtml(room);
    hint.style.display = 'block';
  } else {
    hint.style.display = 'none';
  }
}

export function openRequestModal(roomId) {
  _reqOpenedAt = Date.now(); // bot check: no human fills this form in under ~2s
  const sel = document.getElementById('req-room');
  sel.innerHTML = '<option value="">Select a room...</option>';
  for (const r of ROOMS) sel.innerHTML += `<option value="${r.id}">${r.name} (${r.floor})</option>`;
  if (roomId) sel.value = roomId;
  updateReqCapacityHint();

  document.getElementById('req-date').value = todayStr();
  document.getElementById('req-error').textContent = '';
  document.getElementById('req-error').classList.remove('visible');
  document.getElementById('req-form-view').style.display = '';
  document.getElementById('req-confirm-view').style.display = 'none';
  ['req-booker','req-purpose','req-start','req-end','req-attendees'].forEach(id => document.getElementById(id).value = '');
  const recEl = document.getElementById('req-recurring');
  if (recEl) recEl.checked = false;
  const wrapEl = document.getElementById('req-recurring-end-wrap');
  if (wrapEl) wrapEl.style.display = 'none';
  reqSubmitting = false;
  document.getElementById('request-modal').style.display = 'flex';
}

export function closeRequestModal() {
  document.getElementById('request-modal').style.display = 'none';
  const recEl = document.getElementById('req-recurring');
  if (recEl) recEl.checked = false;
  const wrapEl = document.getElementById('req-recurring-end-wrap');
  if (wrapEl) wrapEl.style.display = 'none';
}

export function validateReqTimes() {
  const s = document.getElementById('req-start').value;
  const e = document.getElementById('req-end').value;
  const errEl = document.getElementById('req-error');
  if (!s || !e) return;
  const sm = minutesSinceMidnight(s), em = minutesSinceMidnight(e);
  if (sm !== null && em !== null && em === sm && s && e) {
    errEl.textContent = 'Start and end time cannot be the same.';
    errEl.classList.add('visible');
  } else {
    if (errEl.textContent.includes('cannot be the same')) errEl.classList.remove('visible');
  }
}

export function showRequestSuccess(newIds, conflictInfo) {
  document.getElementById('req-form-view').style.display = 'none';
  document.getElementById('req-confirm-view').style.display = '';
  reqSubmitting = false;

  const noticeEl = document.getElementById('req-conflict-notice');
  if (conflictInfo && noticeEl) {
    noticeEl.style.display = '';
    noticeEl.innerHTML = conflictInfo;
  } else if (noticeEl) {
    noticeEl.style.display = 'none';
  }

  launchConfetti();
  updatePendingDot();
}

export async function submitRequest() {
  // Bot deterrence: a filled honeypot, or a submission completed
  // suspiciously fast, silently "succeeds" without actually creating a
  // booking — showing an error would teach a bot what tripped it.
  const honeypotFilled = document.getElementById('req-website')?.value;
  const tooFast = _reqOpenedAt && (Date.now() - _reqOpenedAt) < 2000;
  if (honeypotFilled || tooFast) {
    document.getElementById('req-form-view').style.display = 'none';
    document.getElementById('req-confirm-view').style.display = '';
    return;
  }

  const room = document.getElementById('req-room').value;
  const booker = document.getElementById('req-booker').value.trim();
  const purpose = document.getElementById('req-purpose').value.trim();
  const date = document.getElementById('req-date').value;
  const start = document.getElementById('req-start').value;
  const end = document.getElementById('req-end').value;
  const attendees = document.getElementById('req-attendees').value;
  const isRecurring = document.getElementById('req-recurring').checked;
  const dateEnd = document.getElementById('req-date-end') ? document.getElementById('req-date-end').value : '';
  const errEl = document.getElementById('req-error');

  if (!room || !booker || !purpose || !date || !start || !end || !attendees) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.classList.add('visible'); return;
  }
  if (minutesSinceMidnight(end) === minutesSinceMidnight(start)) {
    errEl.textContent = 'Start and end time cannot be the same.';
    errEl.classList.add('visible'); return;
  }
  if (isRecurring && !dateEnd) {
    errEl.textContent = 'Please select an end date for the recurring range.';
    errEl.classList.add('visible'); return;
  }
  if (isRecurring && dateEnd < date) {
    errEl.textContent = 'End date must be on or after start date.';
    errEl.classList.add('visible'); return;
  }
  const selectedRoom = ROOMS.find(r => r.id === room);
  if (selectedRoom && selectedRoom.capacity && Number(attendees) > selectedRoom.capacity) {
    errEl.textContent = `${selectedRoom.name} holds up to ${selectedRoom.capacity} people — you entered ${attendees}. Please pick a larger room or reduce attendees.`;
    errEl.classList.add('visible'); return;
  }
  errEl.classList.remove('visible');

  // Force fresh data before conflict check, to catch bookings made on
  // other devices since this page loaded.
  try {
    showLoadingOverlay(true);
    await loadData(true);
  } catch (e) { /* proceed with cached data if fetch fails */ }
  finally { showLoadingOverlay(false); }

  const dates = isRecurring ? getWeekdays(date, dateEnd) : [date];
  if (dates.length === 0) {
    errEl.textContent = 'No weekdays found in selected range.';
    errEl.classList.add('visible'); return;
  }

  // Conflict check — done BEFORE submitting anything, so a requester with
  // conflicts on some days gets a chance to pick an alternate room for
  // those specific days rather than finding out only after the fact.
  const conflictByDate = {};
  for (const d of dates) {
    const conflicts = findAllConflicts(room, d, start, end, null);
    if (conflicts.length > 0) conflictByDate[d] = conflicts;
  }
  const conflictDates = Object.keys(conflictByDate);

  if (conflictDates.length > 0) {
    const cleanDates = dates.filter(d => !conflictByDate[d]);
    const conflictDateObjs = conflictDates.map(d => ({ date: d, conflict: conflictByDate[d][0] }));
    document.getElementById('request-modal').style.display = 'none';
    openConflictModal({
      room, booker, purpose, start, end, attendees,
      cleanDates, conflictDates: conflictDateObjs,
      status: 'Pending', isPublic: true, isRecurring,
    });
    return;
  }

  try {
    showLoadingOverlay(true);
    reqSubmitting = true;
    const newBookings = dates.map(d => {
      const computedEndDate = minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(d, 1) : d;
      return { id: genId(), room, booker, purpose, date: d, start, end, attendees: attendees || '', status: 'Pending', endDate: computedEndDate };
    });
    await apiCreateRequestBatch(newBookings);
    newBookings.forEach(b => bookings.push(b));

    notifyTeams({
      event: isRecurring ? 'newRecurringRequest' : 'newRequest',
      room: roomName(room), bookedBy: booker, purpose,
      date, dateRange: isRecurring ? `${fmtDate(date)}–${fmtDate(dateEnd)}` : undefined,
      start: fmtTime(start), end: fmtTime(end),
    });

    showRequestSuccess(newBookings.map(b => b.id), null);
  } catch (e) {
    errEl.textContent = 'Error submitting request. Please try again.';
    errEl.classList.add('visible');
    reqSubmitting = false;
  } finally {
    showLoadingOverlay(false);
  }
}
