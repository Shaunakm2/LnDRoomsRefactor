// js/ui/admin-table.js
// The "All Bookings" table, the New Booking / Edit Booking form, bulk
// selection/actions, and Excel export. The single biggest file in the UI
// layer — this is the direct split of the largest chunk of the original
// app.js admin section.

import { ROOMS, roomName, PAGE_SIZE } from '../config.js';
import {
  bookings, tablePage, setTablePage, tablePageLocked, setTablePageLocked,
  deleteTargetId, setDeleteTargetId, setBookings
} from '../state.js';
import { getFilteredBookings, bookingTimeStatus } from '../domain/filters-sort.js';
import { todayStr, minutesSinceMidnight, addDaysStr, isOvernight, getWeekdays } from '../domain/time.js';
import { getLiveConflicts, findConflict, formatLiveConflictNote, getFreeRoomsForDate } from '../domain/conflicts.js';
import { fmtDate, fmtTime, displayPurpose } from '../utils/formatting.js';
import { escHtml, toast, showLoadingOverlay, showConfirmModal } from '../utils/dom-helpers.js';
import { genId } from '../utils/ids.js';
import { loadData } from '../api/supabase-client.js';
import { apiCreate, apiUpdate, apiDelete, apiUpdateStatusBatch } from '../api/bookings.js';
import { notifyTeams } from '../api/notifications.js';
import { roomBadgesHtml } from './status-grid.js';
import { openConflictModal } from './conflict-picker.js';
import { renderStatusGrid } from './status-grid.js';
import { renderPendingRequests, updatePendingDot } from './pending-list.js';

// ---- Table rendering ----
export function renderTable() {
  if (!tablePageLocked) setTablePage(0);
  const tbody = document.getElementById('table-body');
  const prevSelected = new Set(getSelectedIds());

  const filtered = getFilteredBookings();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <div>No bookings found.</div>
    </div></td></tr>`;
    document.getElementById('table-count').textContent = '';
    document.getElementById('pagination-controls').innerHTML = '';
    clearBulkSelection();
    return;
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  let page = tablePage;
  if (page >= totalPages) page = totalPages - 1;
  if (page < 0) page = 0;
  setTablePage(page);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let html = '';
  for (const b of pageItems) {
    let statusBadge;
    if (b.status === 'Pending') {
      statusBadge = `<span class="status-badge" style="background:var(--warn-light);color:var(--warn)">Pending</span>`;
    } else if (b.status === 'Rejected') {
      statusBadge = `<span class="status-badge" style="background:var(--danger-light);color:var(--danger)">Rejected</span>`;
    } else {
      const ts = bookingTimeStatus(b);
      if (ts === 'past') statusBadge = `<span class="status-badge" style="background:#F0EDE6;color:var(--text-muted)">Past</span>`;
      else if (ts === 'active') statusBadge = `<span class="status-badge badge-occupied">Active</span>`;
      else statusBadge = `<span class="status-badge badge-free">Upcoming</span>`;
    }
    const overnightTag = isOvernight(b) ? ' <span style="font-size:10px;color:var(--text-faint);font-weight:600">+1 day</span>' : '';
    const liveConflicts = (b.status === 'Pending' || b.status === 'Confirmed') ? getLiveConflicts(b) : [];
    let conflictNote = '';
    if (liveConflicts.length > 0 && b.conflictResolved) {
      conflictNote = `<div style="color:var(--text-muted);font-size:11px;margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ✓ Resolved${b.conflictNote ? ': ' + escHtml(b.conflictNote) : ''}
        <button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:10px;" onclick="toggleConflictResolved('${b.id}')">Undo</button>
      </div>`;
    } else if (liveConflicts.length > 0) {
      conflictNote = `<div style="color:var(--danger);font-size:11px;font-weight:500;margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span>${escHtml(formatLiveConflictNote(liveConflicts))}</span>
        <button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:10px;flex-shrink:0;" onclick="toggleConflictResolved('${b.id}')">Mark Resolved</button>
      </div>`;
    }
    html += `<tr>
      <td class="cb-cell"><input type="checkbox" class="booking-cb row-cb" data-id="${b.id}" onchange="onRowCbChange()" title="Select"></td>
      <td class="td-room">${escHtml(roomName(b.room))}</td>
      <td>${escHtml(b.booker)}</td>
      <td style="color:var(--text-muted)">${escHtml(displayPurpose(b.purpose) || '—')}${conflictNote}</td>
      <td>${fmtDate(b.date)}</td>
      <td style="white-space:nowrap">${fmtTime(b.start)} – ${fmtTime(b.end)}${overnightTag}</td>
      <td>${b.attendees || '—'}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="editBooking('${b.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBooking('${b.id}')">Delete</button>
        </div>
      </td>
    </tr>`;
  }
  tbody.innerHTML = html;

  document.querySelectorAll('.row-cb').forEach(cb => {
    if (prevSelected.has(cb.dataset.id)) cb.checked = true;
  });
  updateBulkBar();

  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, filtered.length);
  document.getElementById('table-count').textContent = `Showing ${start}–${end} of ${filtered.length} bookings`;

  const pc = document.getElementById('pagination-controls');
  if (totalPages <= 1) { pc.innerHTML = ''; return; }
  let pages = '';
  pages += `<button class="pg-btn" onclick="goToPage(${page - 1})" ${page === 0 ? 'disabled' : ''}>‹</button>`;
  const range = [];
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || (i >= page - 1 && i <= page + 1)) range.push(i);
    else if (range[range.length - 1] !== '…') range.push('…');
  }
  for (const r of range) {
    if (r === '…') pages += `<span style="padding:0 4px;color:var(--text-muted);font-size:13px;">…</span>`;
    else pages += `<button class="pg-btn ${r === page ? 'pg-active' : ''}" onclick="goToPage(${r})">${r + 1}</button>`;
  }
  pages += `<button class="pg-btn" onclick="goToPage(${page + 1})" ${page === totalPages - 1 ? 'disabled' : ''}>›</button>`;
  pc.innerHTML = pages;
}

export function goToPage(page) {
  setTablePage(page);
  setTablePageLocked(true);
  renderTable();
  setTablePageLocked(false);
}

// ---- Active-now sidebar widget ----
export function renderActiveNow() {
  const active = bookings.filter(b => bookingTimeStatus(b) === 'active');
  const el = document.getElementById('active-now-list');
  if (active.length === 0) {
    el.innerHTML = `<div style="font-size:13px;color:var(--text-faint);padding:8px 0;">No active bookings right now.</div>`;
    return;
  }
  el.innerHTML = active.map(b => `
    <div class="booking-list-item active-now">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="flex:1;cursor:pointer;" onclick="editBooking('${b.id}')">
          <div class="bli-room">${escHtml(roomName(b.room))}</div>
          <div class="bli-meta">${escHtml(b.booker)} · until ${fmtTime(b.end)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="flex-shrink:0;" onclick="event.stopPropagation();adminReleaseEarly('${b.id}')">Release Now</button>
      </div>
    </div>
  `).join('');
}

// Admin quick-action — no name verification needed (admin already authenticated).
export async function adminReleaseEarly(bookingId) {
  const b = bookings.find(x => x.id === bookingId);
  if (!b) return;
  if (!(await showConfirmModal(`Release ${roomName(b.room)} now? Booked by ${b.booker}, scheduled until ${fmtTime(b.end)}.`, 'Release Now', 'btn-approve'))) return;
  if (bookingTimeStatus(b) !== 'active') {
    toast('This booking is no longer active.', true);
    return;
  }
  try {
    showLoadingOverlay(true);
    const now = new Date();
    const nowHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    b.end = nowHHMM;
    b.endDate = todayStr();
    await apiUpdate(b);
    toast('Room released — now available.');
    renderStatusGrid(); renderActiveNow(); renderTable();
  } catch (e) {
    toast('Error — please try again.', true);
  } finally {
    showLoadingOverlay(false);
  }
}

// ---- Booking form (New / Edit) ----
export function populateRoomSelects() {
  const roomSelect = document.getElementById('f-room');
  const filterSelect = document.getElementById('filter-room');
  roomSelect.innerHTML = '<option value="">Select a room...</option>';
  filterSelect.innerHTML = '<option value="">All rooms</option>';
  for (const r of ROOMS) {
    roomSelect.innerHTML += `<option value="${r.id}">${r.name} (${r.floor})</option>`;
    filterSelect.innerHTML += `<option value="${r.id}">${r.name}</option>`;
  }
}

export function updateFCapacityHint() {
  const roomId = document.getElementById('f-room').value;
  const hint = document.getElementById('f-capacity-hint');
  if (!hint) return;
  const room = ROOMS.find(r => r.id === roomId);
  hint.innerHTML = roomBadgesHtml(room);
  hint.style.display = room && (room.capacity || room.equipment) ? 'block' : 'none';
}

export function resetForm() {
  document.getElementById('booking-form').reset();
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = 'New Booking';
  document.getElementById('form-submit-btn').textContent = 'Book Room';
  document.getElementById('form-error').classList.remove('visible');
  document.getElementById('f-date').value = todayStr();
  document.getElementById('f-recurring').checked = false;
  document.getElementById('recurring-end-wrap').style.display = 'none';
  document.getElementById('f-end-date-wrap').style.display = 'none';
  document.getElementById('f-end-date').value = '';
  document.getElementById('f-attendees-wrap').style.display = '';
  const dateLabelEl = document.querySelector('label[for="f-date"]') || document.getElementById('f-date').previousElementSibling;
  if (dateLabelEl) dateLabelEl.textContent = 'Start Date';
  if (document.getElementById('edit-id').dataset) delete document.getElementById('edit-id').dataset.fromRequest;
  updateFCapacityHint();
}

export function editBooking(id) {
  const b = bookings.find(x => x.id === id);
  if (!b) return;
  document.getElementById('edit-id').value = b.id;
  document.getElementById('f-room').value = b.room;
  updateFCapacityHint();
  document.getElementById('f-booker').value = b.booker;
  document.getElementById('f-purpose').value = displayPurpose(b.purpose) || '';
  document.getElementById('f-date').value = b.date;
  document.getElementById('f-start').value = b.start;
  document.getElementById('f-end').value = b.end;
  document.getElementById('f-attendees').value = b.attendees || '';

  const isOvernightEdit = minutesSinceMidnight(b.end) < minutesSinceMidnight(b.start);
  const endDateWrap = document.getElementById('f-end-date-wrap');
  const attendeesWrap = document.getElementById('f-attendees-wrap');
  endDateWrap.style.display = isOvernightEdit ? '' : 'none';
  attendeesWrap.style.display = '';
  if (isOvernightEdit) {
    document.getElementById('f-end-date').value = b.endDate || addDaysStr(b.date, 1);
  } else {
    document.getElementById('f-end-date').value = '';
  }
  document.getElementById('form-title').textContent = 'Edit Booking';
  document.getElementById('form-submit-btn').textContent = 'Save Changes';
  document.getElementById('form-error').classList.remove('visible');
  document.getElementById('f-recurring').checked = false;
  document.getElementById('recurring-end-wrap').style.display = 'none';
  document.querySelector('.admin-sidebar').scrollTop = 0;
}

export function showError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.classList.add('visible');
}

export function toggleRecurring() {
  const isRecurring = document.getElementById('f-recurring').checked;
  document.getElementById('recurring-end-wrap').style.display = isRecurring ? 'block' : 'none';
  if (isRecurring) {
    const startDate = document.getElementById('f-date').value;
    if (startDate) document.getElementById('f-date-end').value = startDate;
  }
}

export async function submitBooking(e) {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const room = document.getElementById('f-room').value;
  const booker = document.getElementById('f-booker').value.trim();
  const purpose = document.getElementById('f-purpose').value.trim();
  const date = document.getElementById('f-date').value;
  const start = document.getElementById('f-start').value;
  const end = document.getElementById('f-end').value;
  const attendees = document.getElementById('f-attendees').value;
  const isRecurring = document.getElementById('f-recurring').checked;
  const dateEnd = document.getElementById('f-date-end').value;
  const endDateOverride = document.getElementById('f-end-date').value;

  if (!room || !booker || !purpose || !date || !start || !end || !attendees) {
    showError('Please fill in all required fields.'); return;
  }
  if (minutesSinceMidnight(end) === minutesSinceMidnight(start)) {
    showError('Start and end time cannot be the same.'); return;
  }
  if (isRecurring && !dateEnd) {
    showError('Please select an end date for the recurring range.'); return;
  }
  if (isRecurring && dateEnd < date) {
    showError('End date must be on or after start date.'); return;
  }
  const selectedRoomAdmin = ROOMS.find(r => r.id === room);
  if (selectedRoomAdmin && selectedRoomAdmin.capacity && Number(attendees) > selectedRoomAdmin.capacity) {
    const proceedAnyway = await showConfirmModal(
      `${selectedRoomAdmin.name} holds up to ${selectedRoomAdmin.capacity} people, but this booking has ${attendees} attendees. Book anyway?`,
      'Book Anyway', 'btn-approve'
    );
    if (!proceedAnyway) return;
  }

  const dates = isRecurring ? getWeekdays(date, dateEnd) : [date];
  if (dates.length === 0) { showError('No weekdays found in selected range.'); return; }

  document.getElementById('form-error').classList.remove('visible');
  try { await loadData(true); } catch (e) {}

  // Single booking edit (non-recurring)
  if (id && !isRecurring) {
    const conflict = findConflict(room, date, start, end, id);
    if (conflict) {
      const freeAlts = getFreeRoomsForDate(date, start, end, room);
      let msg = `Conflict: ${roomName(room)} is booked ${fmtTime(conflict.start)}–${fmtTime(conflict.end)} by ${conflict.booker}.`;
      if (freeAlts.length > 0) msg += ` Free alternatives: ${freeAlts.map(r => r.name).join(', ')}.`;
      else msg += ' No other rooms are free at this time.';
      showError(msg);
      return;
    }
    try {
      showLoadingOverlay(true);
      const origStatus = bookings.find(b => b.id === id)?.status || 'Confirmed';
      const computedEndDate = endDateOverride || (minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(date, 1) : date);
      const booking = { id, room, booker, purpose, date, start, end, attendees: attendees || '', status: origStatus, endDate: computedEndDate };
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1) bookings[idx] = booking;
      await apiUpdate(booking);
      toast('Booking updated.');
    } catch (err) { toast('Error saving. Try again.', true); } finally { showLoadingOverlay(false); }
    resetForm(); renderTable(); renderActiveNow(); renderStatusGrid();
    return;
  }

  // Recurring edit — delete original, create new bookings for each date
  if (id && isRecurring) {
    const conflictDates = dates.filter(d => findConflict(room, d, start, end, id));
    if (conflictDates.length > 0) {
      showError(`Conflicts on ${conflictDates.length} date(s): ${conflictDates.slice(0, 3).map(fmtDate).join(', ')}${conflictDates.length > 3 ? '…' : ''}. Resolve conflicts first.`);
      return;
    }
    try {
      showLoadingOverlay(true);
      await apiDelete(id);
      setBookings(bookings.filter(b => b.id !== id));
      for (const d of dates) {
        const computedEndDate = minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(d, 1) : d;
        const booking = { id: genId(), room, booker, purpose, date: d, start, end, attendees: attendees || '', status: 'Confirmed', endDate: computedEndDate };
        bookings.push(booking);
        await apiCreate(booking);
      }
      toast(`Booking updated across ${dates.length} date(s).`);
    } catch (err) { toast('Error saving. Try again.', true); } finally { showLoadingOverlay(false); }
    resetForm(); renderTable(); renderActiveNow(); renderStatusGrid();
    return;
  }

  // Recurring / new booking — check conflicts per date
  const conflictDates = [];
  const cleanDates = [];
  for (const d of dates) {
    const conflict = findConflict(room, d, start, end, null);
    if (conflict) conflictDates.push({ date: d, conflict });
    else cleanDates.push(d);
  }

  if (conflictDates.length === 0) {
    try {
      showLoadingOverlay(true);
      for (const d of dates) {
        const computedEndDate = minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(d, 1) : d;
        const booking = { id: genId(), room, booker, purpose, date: d, start, end, attendees: attendees || '', status: 'Confirmed', endDate: computedEndDate };
        bookings.push(booking);
        await apiCreate(booking);
      }
      toast(dates.length === 1 ? 'Room booked successfully.' : `${dates.length} recurring bookings created (Mon–Fri).`);
    } catch (err) { toast('Error saving. Try again.', true); } finally { showLoadingOverlay(false); }
    resetForm(); renderTable(); renderActiveNow(); renderStatusGrid();
  } else {
    openConflictModal({ room, booker, purpose, start, end, attendees, cleanDates, conflictDates });
  }
}

// ---- Delete ----
export function deleteBooking(id) {
  const b = bookings.find(x => x.id === id);
  if (!b) return;
  setDeleteTargetId(id);
  document.getElementById('delete-modal-sub').textContent =
    `Delete booking for ${roomName(b.room)} by ${b.booker} on ${fmtDate(b.date)}?`;
  document.getElementById('delete-modal').style.display = 'flex';
}

export async function confirmDelete() {
  if (!deleteTargetId) return;
  const idToDelete = deleteTargetId;
  setDeleteTargetId(null);
  document.getElementById('delete-modal').style.display = 'none';
  try {
    showLoadingOverlay(true);
    setBookings(bookings.filter(b => b.id !== idToDelete));
    await apiDelete(idToDelete);
    toast('Booking deleted.');
  } catch (e) {
    toast('Error deleting booking. Try again.', true);
  } finally {
    showLoadingOverlay(false);
  }
  renderTable();
  renderActiveNow();
  renderStatusGrid();
}

// ---- Bulk selection (admin table) ----
export function getSelectedIds() {
  return Array.from(document.querySelectorAll('.row-cb:checked')).map(cb => cb.dataset.id);
}

export function updateBulkBar() {
  const ids = getSelectedIds();
  const bar = document.getElementById('bulk-bar');
  const label = document.getElementById('bulk-count-label');
  if (!bar) return;
  if (ids.length > 0) {
    bar.classList.add('visible');
    label.textContent = ids.length + ' selected';
  } else {
    bar.classList.remove('visible');
  }
  const allCbs = document.querySelectorAll('.row-cb');
  const selAll = document.getElementById('select-all-cb');
  if (selAll) {
    selAll.checked = allCbs.length > 0 && ids.length === allCbs.length;
    selAll.indeterminate = ids.length > 0 && ids.length < allCbs.length;
  }
}

export function onRowCbChange() { updateBulkBar(); }

export function toggleSelectAll(masterCb) {
  document.querySelectorAll('.row-cb').forEach(cb => cb.checked = masterCb.checked);
  updateBulkBar();
}

export function clearBulkSelection() {
  document.querySelectorAll('.row-cb').forEach(cb => cb.checked = false);
  const sa = document.getElementById('select-all-cb');
  if (sa) { sa.checked = false; sa.indeterminate = false; }
  updateBulkBar();
}

export async function bulkApprove() {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  if (!(await showConfirmModal(`Approve ${ids.length} booking(s)?`, 'Approve All', 'btn-approve'))) return;
  showLoadingOverlay(true);
  try {
    ids.forEach(id => {
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1) bookings[idx].status = 'Confirmed';
    });
    await apiUpdateStatusBatch(ids, 'Confirmed');
    toast(`${ids.length} booking(s) approved.`);
    notifyTeams({ event: 'batchApproved', count: ids.length });
  } catch (e) { toast('Error during bulk approve.', true); }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();
}

export async function bulkCancel() {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  if (!(await showConfirmModal(`Cancel ${ids.length} booking(s)?`, 'Cancel Bookings', 'btn-danger'))) return;
  showLoadingOverlay(true);
  try {
    await apiUpdateStatusBatch(ids, 'Cancelled');
    ids.forEach(id => {
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1) bookings[idx].status = 'Cancelled';
    });
    toast(`${ids.length} booking(s) cancelled.`);
  } catch (e) { toast('Error during bulk cancel.', true); }
  finally { showLoadingOverlay(false); }
  renderTable(); renderActiveNow(); renderStatusGrid(); renderPendingRequests(); updatePendingDot();
}

export async function bulkDelete() {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  if (!(await showConfirmModal(`Permanently delete ${ids.length} booking(s)? This cannot be undone.`, 'Delete Permanently', 'btn-danger'))) return;
  showLoadingOverlay(true);
  try {
    for (const id of ids) {
      await apiDelete(id);
      setBookings(bookings.filter(b => b.id !== id));
    }
    toast(`${ids.length} booking(s) deleted.`);
  } catch (e) { toast('Error during bulk delete.', true); }
  finally { showLoadingOverlay(false); }
  renderTable(); renderActiveNow(); renderStatusGrid(); renderPendingRequests();
}

// ---- Excel export ----
export function exportExcel() {
  const headers = ['Room','Floor','Booked By','Purpose','Date','Start Time','End Time','Attendees','Status','Conflict Note'];
  const filtered = getFilteredBookings();
  const rows = filtered.map(b => {
    const room = ROOMS.find(r => r.id === b.room) || {};
    let status;
    if (b.status === 'Pending') status = 'Pending';
    else if (b.status === 'Rejected') status = 'Rejected';
    else if (b.status === 'Cancelled') status = 'Cancelled';
    else {
      const ts = bookingTimeStatus(b);
      status = ts === 'past' ? 'Past' : ts === 'active' ? 'Active' : 'Upcoming';
    }
    return {
      'Room': room.name || b.room,
      'Floor': room.floor || '',
      'Booked By': b.booker,
      'Purpose': displayPurpose(b.purpose) || '',
      'Date': b.date,
      'Start Time': fmtTime(b.start),
      'End Time': fmtTime(b.end),
      'Attendees': b.attendees || '',
      'Status': status,
      'Conflict Note': b.conflictResolved ? (b.conflictNote || '(resolved, no note)') : ''
    };
  });
  if (typeof XLSX === 'undefined') {
    toast('Loading Excel library, please try again in a moment.', true);
    return;
  }
  if (rows.length === 0) {
    toast('No bookings match the current filters — nothing to export.', true);
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = [20,18,22,28,14,14,14,12,12,30].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Room Bookings');
  const filterRoomId = document.getElementById('filter-room')?.value;
  const roomSuffix = filterRoomId ? '-' + roomName(filterRoomId).toLowerCase().replace(/\s+/g, '-') : '';
  XLSX.writeFile(wb, `room-bookings${roomSuffix}-${todayStr()}.xlsx`);

  const totalCount = bookings.length;
  toast(rows.length === totalCount
    ? 'Excel file downloaded (' + rows.length + ' bookings).'
    : 'Excel file downloaded — ' + rows.length + ' of ' + totalCount + ' bookings (filters applied).');
}
