// js/ui/conflict-picker.js
// Three modes share this one modal:
//   1. Public requester picking alternates for a recurring request
//   2. Admin creating a new booking that conflicts
//   3. Admin approving a pending request that conflicts
// This grew into the most complex file in the refactor — see the
// dispatch-by-s.mode pattern in renderConflictModal/confirmConflictResolution.
// If a 4th mode is ever needed, consider splitting these into three
// smaller functions with a thin dispatcher instead of growing this further.

import { ROOMS, roomName } from '../config.js';
import { bookings } from '../state.js';
import { minutesSinceMidnight, addDaysStr } from '../domain/time.js';
import { findConflict } from '../domain/conflicts.js';
import { fmtDate, fmtTime } from '../utils/formatting.js';
import { escHtml, toast, showLoadingOverlay } from '../utils/dom-helpers.js';
import { genId } from '../utils/ids.js';
import { apiCreate, apiUpdate, apiUpdateStatus, apiCreateRequestBatch } from '../api/bookings.js';
import { notifyTeams } from '../api/notifications.js';
import { renderStatusGrid } from './status-grid.js';
import { renderTable, renderActiveNow, resetForm } from './admin-table.js';
import { renderPendingRequests, updatePendingDot } from './pending-list.js';
import { showRequestSuccess } from './request-form.js';

function getFreeRoomsForDate(date, start, end, excludeRoom) {
  return ROOMS.filter(r => {
    if (r.id === excludeRoom) return false;
    return !findConflict(r.id, date, start, end, null);
  });
}

let _conflictSession = null;

// ---- Mode 3: admin approving a conflicting pending request ----
export function openApprovalConflictModal(items) {
  _conflictSession = { mode: 'adminApprove', items, resolutions: {} };
  items.forEach(it => { _conflictSession.resolutions[it.id] = null; });
  document.getElementById('conflict-modal-desc').textContent =
    `${items.length} pending request(s) conflict with an existing booking. Choose an alternate room, approve anyway, or skip each one.`;
  renderConflictModal();
  document.getElementById('conflict-modal').style.display = 'flex';
}

export function selectApprovalResolution(id, choice) {
  _conflictSession.resolutions[id] = choice;
  renderConflictModal();
}

// ---- Modes 1 & 2: public request / admin new-booking ----
export function openConflictModal(session) {
  _conflictSession = session;
  session.resolutions = {};
  session.conflictDates.forEach(cd => { session.resolutions[cd.date] = null; });

  const totalDates = session.cleanDates.length + session.conflictDates.length;
  const verb = session.isPublic ? 'requested' : 'have conflicts';
  document.getElementById('conflict-modal-desc').textContent =
    `${session.conflictDates.length} of ${totalDates} date(s) are already ${verb}. Choose an alternative room or skip each date.`;

  renderConflictModal();
  document.getElementById('conflict-modal').style.display = 'flex';
}

export function selectAlt(date, roomId) {
  _conflictSession.resolutions[date] = roomId;
  renderConflictModal();
}

// ---- Shared render, dispatches by mode ----
export function renderConflictModal() {
  const s = _conflictSession;

  if (s.mode === 'adminApprove') {
    let html = '';
    s.items.forEach(it => {
      const freeRooms = getFreeRoomsForDate(it.date, it.start, it.end, it.room);
      const chosen = s.resolutions[it.id];
      const blockClass = chosen === 'skip' ? '' : chosen === 'anyway' ? 'resolved' : chosen ? 'resolved' : 'has-conflict';

      html += `<div class="conflict-date-block ${blockClass}" id="cblock-${it.id}">
        <div class="conflict-date-label">${escHtml(it.booker)} — ${fmtDate(it.date)}, ${fmtTime(it.start)}–${fmtTime(it.end)}</div>
        <div class="conflict-reason">⚠️ ${roomName(it.room)} already booked ${fmtTime(it.conflict.start)}–${fmtTime(it.conflict.end)} by ${escHtml(it.conflict.booker)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin:6px 0;">Options:</div>
        <div class="conflict-alts">`;
      freeRooms.forEach(r => {
        const sel = chosen === r.id ? 'selected' : '';
        html += `<button class="alt-btn ${sel}" onclick="selectApprovalResolution('${it.id}','${r.id}')">${escHtml(r.name)}<span style="opacity:0.6;font-size:11px;margin-left:4px">${escHtml(r.floor)}</span></button>`;
      });
      html += `<button class="alt-btn ${chosen === 'anyway' ? 'selected' : ''}" onclick="selectApprovalResolution('${it.id}','anyway')">Approve anyway (${escHtml(roomName(it.room))})</button>`;
      html += `<button class="alt-btn skip-btn ${chosen === 'skip' ? 'selected' : ''}" onclick="selectApprovalResolution('${it.id}','skip')">Skip (leave Pending)</button>`;
      html += `</div>`;

      if (chosen && chosen !== 'skip' && chosen !== 'anyway') {
        html += `<div class="conflict-resolved-label" style="margin-top:8px;">✅ Will approve in ${roomName(chosen)}</div>`;
      } else if (chosen === 'anyway') {
        html += `<div class="conflict-resolved-label" style="margin-top:8px;">✅ Will approve anyway in ${roomName(it.room)}</div>`;
      } else if (chosen === 'skip') {
        html += `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">⏭️ Leaving this one Pending</div>`;
      }
      html += `</div>`;
    });
    document.getElementById('conflict-modal-body').innerHTML = html;
    return;
  }

  let html = '';

  if (s.cleanDates.length > 0) {
    const verb = s.isPublic ? 'requested' : 'booked';
    html += `<div style="margin-bottom:1rem;padding:10px 12px;background:var(--ok-light);border-radius:var(--radius);font-size:13px;color:var(--ok);">
      <strong>✅ ${s.cleanDates.length} date(s) will be ${verb} in ${roomName(s.room)}:</strong>
      <div style="margin-top:4px;color:var(--text-muted)">${s.cleanDates.map(d => fmtDate(d)).join(' · ')}</div>
    </div>`;
  }

  s.conflictDates.forEach(cd => {
    const freeRooms = getFreeRoomsForDate(cd.date, s.start, s.end, s.room);
    const chosen = s.resolutions[cd.date];
    const isSkipped = chosen === 'skip';
    const isResolved = chosen && chosen !== 'skip';
    const blockClass = isResolved ? 'resolved' : isSkipped ? '' : 'has-conflict';

    html += `<div class="conflict-date-block ${blockClass}" id="cblock-${cd.date}">
      <div class="conflict-date-label">${fmtDate(cd.date)}</div>
      <div class="conflict-reason">⚠️ ${roomName(s.room)} booked ${fmtTime(cd.conflict.start)}–${fmtTime(cd.conflict.end)} by ${escHtml(cd.conflict.booker)}</div>`;

    if (freeRooms.length > 0) {
      html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Available alternatives:</div>
        <div class="conflict-alts">`;
      freeRooms.forEach(r => {
        const sel = chosen === r.id ? 'selected' : '';
        html += `<button class="alt-btn ${sel}" onclick="selectAlt('${cd.date}','${r.id}')">${escHtml(r.name)}<span style="opacity:0.6;font-size:11px;margin-left:4px">${escHtml(r.floor)}</span></button>`;
      });
      html += `<button class="alt-btn skip-btn ${isSkipped ? 'selected' : ''}" onclick="selectAlt('${cd.date}','skip')">Skip this date</button>`;
      html += `</div>`;
    } else {
      html += `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">No rooms available at this time — this date will be skipped.</div>`;
      s.resolutions[cd.date] = 'skip';
    }

    if (isResolved) {
      html += `<div class="conflict-resolved-label" style="margin-top:8px;">✅ Will book ${roomName(chosen)}</div>`;
    } else if (isSkipped) {
      html += `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">⏭️ Skipping this date</div>`;
    }

    html += `</div>`;
  });

  document.getElementById('conflict-modal-body').innerHTML = html;
}

export function closeConflictModal() {
  document.getElementById('conflict-modal').style.display = 'none';
  if (_conflictSession && _conflictSession.isPublic) {
    document.getElementById('request-modal').style.display = 'flex';
  }
  _conflictSession = null;
}

// ---- Shared confirm, dispatches by mode ----
export async function confirmConflictResolution() {
  const s = _conflictSession;

  if (s.mode === 'adminApprove') {
    const unresolved = s.items.filter(it => s.resolutions[it.id] === null);
    if (unresolved.length > 0) {
      toast('Please choose an option for every conflicting request.', true);
      return;
    }
    document.getElementById('conflict-modal').style.display = 'none';
    try {
      showLoadingOverlay(true);
      let approved = 0, skipped = 0;
      for (const it of s.items) {
        const choice = s.resolutions[it.id];
        if (choice === 'skip') { skipped++; continue; }
        const idx = bookings.findIndex(b => b.id === it.id);
        if (idx === -1) continue;
        if (choice === 'anyway') {
          bookings[idx].status = 'Confirmed';
          await apiUpdateStatus(it.id, 'Confirmed');
        } else {
          const moved = { ...bookings[idx], room: choice, status: 'Confirmed' };
          bookings[idx] = moved;
          await apiUpdate(moved);
        }
        approved++;
        notifyTeams({ event: 'approved', room: roomName(bookings[idx].room), bookedBy: bookings[idx].booker, purpose: bookings[idx].purpose, date: bookings[idx].date, start: fmtTime(bookings[idx].start), end: fmtTime(bookings[idx].end) });
      }
      let msg = `${approved} request(s) approved ✅`;
      if (skipped > 0) msg += `, ${skipped} left Pending.`;
      toast(msg);
    } catch (err) {
      toast('Error approving. Try again.', true);
    } finally {
      showLoadingOverlay(false);
    }
    _conflictSession = null;
    renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();
    return;
  }

  const unresolved = s.conflictDates.filter(cd => s.resolutions[cd.date] === null);
  if (unresolved.length > 0) {
    toast('Please choose an alternative or skip for all conflicted dates.', true);
    return;
  }

  document.getElementById('conflict-modal').style.display = 'none';

  if (s.isPublic) {
    try {
      showLoadingOverlay(true);
      const newBookings = [];
      for (const d of s.cleanDates) {
        const computedEndDate = minutesSinceMidnight(s.end) < minutesSinceMidnight(s.start) ? addDaysStr(d, 1) : d;
        newBookings.push({ id: genId(), room: s.room, booker: s.booker, purpose: s.purpose, date: d, start: s.start, end: s.end, attendees: s.attendees || '', status: 'Pending', endDate: computedEndDate });
      }
      for (const cd of s.conflictDates) {
        const chosenRoom = s.resolutions[cd.date];
        if (chosenRoom === 'skip') continue;
        const computedEndDate = minutesSinceMidnight(s.end) < minutesSinceMidnight(s.start) ? addDaysStr(cd.date, 1) : cd.date;
        newBookings.push({ id: genId(), room: chosenRoom, booker: s.booker, purpose: s.purpose, date: cd.date, start: s.start, end: s.end, attendees: s.attendees || '', status: 'Pending', endDate: computedEndDate });
      }
      if (newBookings.length > 0) {
        await apiCreateRequestBatch(newBookings);
        newBookings.forEach(b => bookings.push(b));
      }

      const skipped = s.conflictDates.filter(cd => s.resolutions[cd.date] === 'skip').length;
      const movedCount = s.conflictDates.filter(cd => s.resolutions[cd.date] !== 'skip').length;
      let info = null;
      if (movedCount > 0 || skipped > 0) {
        const parts = [];
        if (movedCount > 0) parts.push(`${movedCount} day(s) requested in an alternate room`);
        if (skipped > 0) parts.push(`${skipped} day(s) skipped (no rooms free)`);
        info = `ℹ️ <strong>Note:</strong> ${parts.join(', ')}. Your requests have been submitted — please check with the admin for confirmation.`;
      }

      notifyTeams({
        event: s.isRecurring ? 'newRecurringRequest' : 'newRequest',
        room: roomName(s.room), bookedBy: s.booker, purpose: s.purpose,
        date: s.cleanDates[0] || s.conflictDates[0]?.date, start: fmtTime(s.start), end: fmtTime(s.end),
      });

      document.getElementById('request-modal').style.display = 'flex';
      showRequestSuccess(newBookings.map(b => b.id), info);
    } catch (err) {
      document.getElementById('request-modal').style.display = 'flex';
      const errEl = document.getElementById('req-error');
      errEl.textContent = 'Error submitting request. Please try again.';
      errEl.classList.add('visible');
    } finally {
      showLoadingOverlay(false);
    }
    _conflictSession = null;
    return;
  }

  try {
    showLoadingOverlay(true);
    let count = 0;

    for (const d of s.cleanDates) {
      const computedEndDate = minutesSinceMidnight(s.end) < minutesSinceMidnight(s.start) ? addDaysStr(d, 1) : d;
      const booking = { id: genId(), room: s.room, booker: s.booker, purpose: s.purpose, date: d, start: s.start, end: s.end, attendees: s.attendees || '', status: 'Confirmed', endDate: computedEndDate };
      bookings.push(booking);
      await apiCreate(booking);
      count++;
    }

    for (const cd of s.conflictDates) {
      const chosenRoom = s.resolutions[cd.date];
      if (chosenRoom === 'skip') continue;
      const computedEndDate = minutesSinceMidnight(s.end) < minutesSinceMidnight(s.start) ? addDaysStr(cd.date, 1) : cd.date;
      const booking = { id: genId(), room: chosenRoom, booker: s.booker, purpose: s.purpose, date: cd.date, start: s.start, end: s.end, attendees: s.attendees || '', status: 'Confirmed', endDate: computedEndDate };
      bookings.push(booking);
      await apiCreate(booking);
      count++;
    }

    const skipped = s.conflictDates.filter(cd => s.resolutions[cd.date] === 'skip').length;
    let msg = `${count} booking(s) created.`;
    if (skipped > 0) msg += ` ${skipped} date(s) skipped.`;
    toast(msg);
  } catch (err) {
    toast('Error saving bookings. Try again.', true);
  } finally {
    showLoadingOverlay(false);
  }

  _conflictSession = null;
  resetForm();
  renderTable();
  renderActiveNow();
  renderStatusGrid();
}
