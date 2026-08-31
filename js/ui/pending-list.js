// js/ui/pending-list.js
// The Pending Requests section. Approve/reject flows route through
// conflict-picker.js's admin-approval mode when there's a conflict,
// instead of a blunt "approve anyway?" — see openApprovalConflictModal.

import { ROOMS, roomName } from '../config.js';
import { bookings } from '../state.js';
import { minutesSinceMidnight, addDaysStr, todayStr } from '../domain/time.js';
import { getLiveConflicts, findConflict, formatLiveConflictNote } from '../domain/conflicts.js';
import { fmtDate, fmtTime, displayPurpose } from '../utils/formatting.js';
import { escHtml, toast, showLoadingOverlay, showConfirmModal } from '../utils/dom-helpers.js';
import { apiUpdateStatus, apiUpdate, apiUpdateStatusBatch } from '../api/bookings.js';
import { notifyTeams } from '../api/notifications.js';
import { openApprovalConflictModal } from './conflict-picker.js';
import { renderStatusGrid } from './status-grid.js';
import { renderTable, renderActiveNow } from './admin-table.js';

let rejectTargetId = null;

export function updatePendingDot() {
  const count = bookings.filter(b => b.status === 'Pending').length;
  document.getElementById('nav-pending-dot').style.display = count > 0 ? '' : 'none';
}

export function renderPendingRequests() {
  const pending = bookings.filter(b => b.status === 'Pending');
  const section = document.getElementById('pending-section');
  const list = document.getElementById('pending-list');
  document.getElementById('pending-count').textContent = pending.length;

  if (pending.length === 0) {
    section.style.display = 'none';
    updatePendingDot();
    return;
  }
  section.style.display = '';
  updatePendingDot();

  const today = todayStr();
  list.innerHTML = pending.sort((a, b) => {
    // Expired (date already passed) requests sink to the bottom.
    const aExpired = a.date < today, bExpired = b.date < today;
    if (aExpired !== bExpired) return aExpired ? 1 : -1;
    return (a.date + a.start) < (b.date + b.start) ? -1 : 1;
  }).map(b => {
    const isExpired = b.date < today;
    const liveConflicts = getLiveConflicts(b);
    let conflictNote = '';
    if (liveConflicts.length > 0 && b.conflictResolved) {
      conflictNote = `<div class="pending-meta" style="color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ✓ Resolved${b.conflictNote ? ': ' + escHtml(b.conflictNote) : ''}
        <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;" onclick="toggleConflictResolved('${b.id}')">Undo</button>
      </div>`;
    } else if (liveConflicts.length > 0) {
      conflictNote = `<div class="pending-meta" style="color:var(--danger);font-weight:500;margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span>${escHtml(formatLiveConflictNote(liveConflicts))}</span>
        <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;flex-shrink:0;" onclick="toggleConflictResolved('${b.id}')">Mark Resolved</button>
      </div>`;
    }
    return `
    <div class="pending-item" id="pending-item-${b.id}">
      <div class="pending-item-top">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <input type="checkbox" class="booking-cb pending-cb" data-id="${b.id}" onchange="onPendingCbChange()" style="margin-top:3px;accent-color:var(--warn);width:15px;height:15px;cursor:pointer;flex-shrink:0;">
          <div>
            <div class="pending-room-name">${escHtml(roomName(b.room))}${isExpired ? ' <span style="font-size:11px;font-weight:600;color:var(--text-faint);background:var(--surface2);padding:2px 8px;border-radius:999px;vertical-align:middle;">⏰ Date passed</span>' : ''}</div>
            <div class="pending-meta">${escHtml(b.booker)}${b.purpose ? ' &middot; ' + escHtml(displayPurpose(b.purpose)) : ''}</div>
            <div class="pending-meta">${fmtDate(b.date)} &middot; ${fmtTime(b.start)} – ${fmtTime(b.end)}${b.attendees ? ' &middot; ' + b.attendees + ' attendees' : ''}</div>
            ${conflictNote}
          </div>
        </div>
      </div>
      <div class="pending-actions">
        <button class="btn btn-sm btn-approve" onclick="approvePending('${b.id}')">✅ Approve</button>
        <button class="btn btn-sm btn-modify" onclick="toggleModifyForm('${b.id}')">✏️ Modify & Approve</button>
        <button class="btn btn-sm btn-reject" onclick="openRejectModal('${b.id}')">❌ Reject</button>
      </div>
      <div class="modify-form" id="modify-form-${b.id}">
        <div class="form-row">
          <div class="form-group" style="grid-column:1/-1"><label>Room</label><select id="mod-room-${b.id}">${ROOMS.map(r => `<option value="${r.id}" ${r.id === b.room ? 'selected' : ''}>${r.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Date</label><input type="date" id="mod-date-${b.id}" value="${b.date}"></div>
          <div class="form-group"><label>Attendees</label><input type="number" id="mod-att-${b.id}" value="${b.attendees || ''}" min="1" max="200" placeholder="—"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Start Time</label><input type="time" id="mod-start-${b.id}" value="${b.start}"></div>
          <div class="form-group"><label>End Time</label><input type="time" id="mod-end-${b.id}" value="${b.end}"></div>
        </div>
        <div class="flex-gap" style="margin-top:8px">
          <button class="btn btn-sm btn-approve" onclick="modifyAndApprove('${b.id}')">Confirm & Approve</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleModifyForm('${b.id}')">Cancel</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

export function toggleModifyForm(id) {
  document.getElementById('modify-form-' + id).classList.toggle('open');
}

export async function approvePending(id) {
  const idx = bookings.findIndex(b => b.id === id);
  if (idx === -1) return;
  const b = bookings[idx];
  const conflict = findConflict(b.room, b.date, b.start, b.end, id);
  if (conflict) {
    openApprovalConflictModal([{ id: b.id, room: b.room, date: b.date, start: b.start, end: b.end, booker: b.booker, purpose: b.purpose, conflict }]);
    return;
  }
  try {
    showLoadingOverlay(true);
    bookings[idx].status = 'Confirmed';
    await apiUpdateStatus(id, 'Confirmed');
    toast('Booking approved ✅');
    notifyTeams({ event: 'approved', room: roomName(b.room), bookedBy: b.booker, purpose: b.purpose, date: b.date, start: fmtTime(b.start), end: fmtTime(b.end) });
  } catch (e) { toast('Error approving booking.', true); }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();
}

export async function modifyAndApprove(id) {
  const idx = bookings.findIndex(b => b.id === id);
  if (idx === -1) return;
  const room = document.getElementById('mod-room-' + id)?.value || bookings[idx].room;
  const date = document.getElementById('mod-date-' + id).value;
  const start = document.getElementById('mod-start-' + id).value;
  const end = document.getElementById('mod-end-' + id).value;
  const attendees = document.getElementById('mod-att-' + id).value;
  if (!date || !start || !end) { toast('Please fill in all fields.', true); return; }
  if (minutesSinceMidnight(end) === minutesSinceMidnight(start)) { toast('Start and end time cannot be the same.', true); return; }
  const conflict = findConflict(room, date, start, end, id);
  if (conflict) { if (!(await showConfirmModal(`⚠️ Conflict: ${roomName(room)} is booked ${fmtTime(conflict.start)}–${fmtTime(conflict.end)} by ${conflict.booker}.\n\nApprove anyway?`, 'Approve Anyway', 'btn-modify'))) return; }
  const modEndDate = minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(date, 1) : date;
  const b = { ...bookings[idx], room, date, start, end, attendees: attendees || '', status: 'Confirmed', endDate: modEndDate };
  try {
    showLoadingOverlay(true);
    bookings[idx] = b;
    await apiUpdate(b);
    toast('Booking modified & approved ✅');
    notifyTeams({ event: 'approved', room: roomName(b.room), bookedBy: b.booker, purpose: b.purpose, date: b.date, start: fmtTime(b.start), end: fmtTime(b.end) });
  } catch (e) { toast('Error updating booking.', true); }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();
}

export function openRejectModal(id) {
  rejectTargetId = id;
  const b = bookings.find(x => x.id === id);
  document.getElementById('reject-modal-sub').textContent =
    b ? `Reject booking for ${roomName(b.room)} by ${b.booker} on ${fmtDate(b.date)}?` : 'This request will be removed.';
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-modal').style.display = 'flex';
}

export async function confirmReject() {
  if (!rejectTargetId) return;
  const id = rejectTargetId; rejectTargetId = null;
  document.getElementById('reject-modal').style.display = 'none';
  const b = bookings.find(x => x.id === id);
  try {
    showLoadingOverlay(true);
    const idx = bookings.findIndex(x => x.id === id);
    if (idx !== -1) bookings[idx].status = 'Rejected';
    await apiUpdateStatus(id, 'Rejected');
    toast('Request rejected.');
    if (b) notifyTeams({ event: 'deletedOrRejected', room: roomName(b.room), bookedBy: b.booker, purpose: b.purpose, date: b.date, start: fmtTime(b.start), end: fmtTime(b.end) });
  } catch (e) { toast('Error rejecting request.', true); }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();
}

// ---- Pending-specific bulk selection ----
export function getPendingSelectedIds() {
  return Array.from(document.querySelectorAll('.pending-cb:checked')).map(cb => cb.dataset.id);
}

export function updatePendingBulkBar() {
  const ids = getPendingSelectedIds();
  const bar = document.getElementById('pending-bulk-bar');
  const label = document.getElementById('pending-bulk-label');
  if (!bar) return;
  bar.style.display = ids.length > 0 ? 'flex' : 'none';
  if (label) label.textContent = ids.length + ' selected';
  const selAll = document.getElementById('pending-select-all');
  const allCbs = document.querySelectorAll('.pending-cb');
  if (selAll) {
    selAll.checked = allCbs.length > 0 && ids.length === allCbs.length;
    selAll.indeterminate = ids.length > 0 && ids.length < allCbs.length;
  }
}

export function onPendingCbChange() { updatePendingBulkBar(); }

export function togglePendingSelectAll(masterCb) {
  document.querySelectorAll('.pending-cb').forEach(cb => cb.checked = masterCb.checked);
  updatePendingBulkBar();
}

export function clearPendingSelection() {
  document.querySelectorAll('.pending-cb').forEach(cb => cb.checked = false);
  const sa = document.getElementById('pending-select-all');
  if (sa) { sa.checked = false; sa.indeterminate = false; }
  updatePendingBulkBar();
}

export async function bulkApprovePending() {
  const ids = getPendingSelectedIds();
  if (ids.length === 0) return;
  if (!(await showConfirmModal(`Approve ${ids.length} pending request(s)?`, 'Approve All', 'btn-approve'))) return;

  const cleanIds = [];
  const conflictItems = [];
  for (const id of ids) {
    const b = bookings.find(x => x.id === id);
    if (!b) continue;
    const conflict = findConflict(b.room, b.date, b.start, b.end, id);
    if (conflict) conflictItems.push({ id: b.id, room: b.room, date: b.date, start: b.start, end: b.end, booker: b.booker, purpose: b.purpose, conflict });
    else cleanIds.push(id);
  }

  showLoadingOverlay(true);
  try {
    if (cleanIds.length > 0) {
      cleanIds.forEach(id => {
        const idx = bookings.findIndex(b => b.id === id);
        if (idx !== -1) bookings[idx].status = 'Confirmed';
      });
      await apiUpdateStatusBatch(cleanIds, 'Confirmed');
      notifyTeams({ event: 'batchApproved', count: cleanIds.length });
    }
    let msg = `${cleanIds.length} request(s) approved ✅`;
    if (conflictItems.length > 0) msg += ` — ${conflictItems.length} have conflicts, resolve below.`;
    toast(msg);
  } catch (e) { toast('Error during bulk approve.', true); }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();

  if (conflictItems.length > 0) openApprovalConflictModal(conflictItems);
}

export async function bulkRejectPending() {
  const ids = getPendingSelectedIds();
  if (ids.length === 0) return;
  if (!(await showConfirmModal(`Reject ${ids.length} pending request(s)? They will be marked Rejected.`, 'Reject All', 'btn-danger'))) return;
  showLoadingOverlay(true);
  let rejected = 0;
  try {
    for (const id of ids) {
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1) {
        const b = bookings[idx];
        bookings[idx].status = 'Rejected';
        await apiUpdateStatus(id, 'Rejected');
        notifyTeams({ event: 'deletedOrRejected', room: roomName(b.room), bookedBy: b.booker, purpose: b.purpose, date: b.date, start: fmtTime(b.start), end: fmtTime(b.end) });
        rejected++;
      }
    }
    toast(`${rejected} request(s) rejected.`);
  } catch (e) { toast('Error during bulk reject.', true); }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();
}
