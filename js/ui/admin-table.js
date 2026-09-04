// js/ui/admin-table.js
// The "All Bookings" table, the New Booking / Edit Booking form, bulk
// selection/actions, and Excel export. The single biggest file in the UI
// layer — this is the direct split of the largest chunk of the original
// app.js admin section.

import { ROOMS, roomName, PAGE_SIZE } from '../config.js';
import {
  bookings, tablePage, setTablePage,
  deleteTargetId, setDeleteTargetId, setBookings, setSortField, setSortDir,
  selectedIds, setSelectedIds
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
import { openConflictModal, openApprovalConflictModal } from './conflict-picker.js';
import { renderStatusGrid } from './status-grid.js';
import { renderPendingRequests, updatePendingDot } from './pending-list.js';

// ---- Table rendering ----
export function renderTable() {
  // Deliberately does NOT reset tablePage. It used to do
  // `if (!tablePageLocked) setTablePage(0)`, and goToPage()'s lock only
  // survived that one render — so the 60-second poll and every tab-focus
  // ejected the admin from page 3 back to page 1, mid-read. The page is
  // reset where the USER changes what is displayed: onFilterChange() and
  // onSortChange() both call setTablePage(0) already. Lines below clamp
  // tablePage to the available range, so a page that no longer exists after
  // a data change falls back safely.
  const tbody = document.getElementById('table-body');
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
      <td class="cb-cell"><input type="checkbox" class="booking-cb row-cb" data-id="${b.id}" onchange="onRowCbChange(this)" title="Select"></td>
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

  // Selection lives in state.js, so rows selected on another page stay
  // selected and simply re-tick when that page is rendered again.
  document.querySelectorAll('.row-cb').forEach(cb => {
    if (selectedIds.has(cb.dataset.id)) cb.checked = true;
  });
  updateBulkBar();

  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, filtered.length);
  // Say when rows are being withheld. Silently hiding records is how an admin
  // concludes their data has vanished.
  const hiddenRejected = document.getElementById('filter-show-rejected')?.checked
    ? 0
    : bookings.filter(b => b.status === 'Rejected').length;
  document.getElementById('table-count').textContent =
    `Showing ${start}–${end} of ${filtered.length} bookings`
    + (hiddenRejected > 0 ? ` · ${hiddenRejected} rejected hidden` : '');

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
  // tablePageLocked used to be set around this call, purely to stop
  // renderTable() resetting the page it had just been asked to show. That
  // reset is gone, so the lock guards nothing. state.js's tablePageLocked
  // and setTablePageLocked are now unused and can be deleted.
  setTablePage(page);
  renderTable();
}

// ---- Filter/sort controls (index.html) ----
// Pre-refactor, index.html's filter and sort inputs assigned straight to
// app.js's module-level _tablePage/_sortField/_sortDir from inline onchange
// attributes. Those variables now live in state.js and are unreachable from
// inline HTML — an inline `_sortField = 'room'` just created an unread
// window global, so the sort dropdown silently did nothing. These two
// functions give the HTML a plain call that routes through the real setters.
export function onFilterChange() {
  setTablePage(0);
  renderTable();
}

export function onSortChange(sel) {
  const [field, dir] = (sel?.value || '').split('-');
  if (field) setSortField(field);
  if (dir) setSortDir(dir);
  setTablePage(0);
  renderTable();
}

// ---- Active-now sidebar widget ----
export function renderActiveNow() {
  // MUST filter on status as well as time. bookingTimeStatus() answers only
  // "is now inside this booking's window" — it deliberately knows nothing
  // about status, which is correct for a time function but wrong as the sole
  // filter here. Without the status check, a Rejected or Cancelled booking
  // whose window happens to contain the current time appeared under ACTIVE
  // NOW, complete with a "Release Now" button, while the timeline correctly
  // showed the room as free. Two components disagreeing about the same row.
  const active = bookings.filter(b =>
    (b.status === 'Confirmed' || !b.status) && bookingTimeStatus(b) === 'active'
  );
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
  // Status as well as time. adminReleaseEarly writes via apiUpdate, which
  // has no server-side status check of its own (unlike release_own_booking,
  // which requires Confirmed), so releasing a Rejected or Cancelled booking
  // would have silently rewritten its end time. Unreachable from the UI now
  // that renderActiveNow filters by status, but this is the function that
  // actually performs the write.
  if (b.status !== 'Confirmed' && b.status) {
    toast(`This booking is ${String(b.status).toLowerCase()}, not active.`, true);
    return;
  }
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
    let editFailed = false;
    try {
      showLoadingOverlay(true);
      const origStatus = bookings.find(b => b.id === id)?.status || 'Confirmed';
      const computedEndDate = endDateOverride || (minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(date, 1) : date);
      const booking = { id, room, booker, purpose, date, start, end, attendees: attendees || '', status: origStatus, endDate: computedEndDate };
      const idx = bookings.findIndex(b => b.id === id);
      // Keep the pre-edit row so a failed write can be undone. Without this,
      // the table shows the edit as saved while the database still holds the
      // old values, and the change silently reverts on the next refresh.
      const prevRow = idx !== -1 ? bookings[idx] : null;
      if (idx !== -1) bookings[idx] = booking;
      try {
        await apiUpdate(booking);
      } catch (err) {
        if (idx !== -1 && prevRow) bookings[idx] = prevRow;
        throw err;
      }
      toast('Booking updated.');
      editFailed = false;
    } catch (err) {
      editFailed = true;
      showError('Could not save the booking — nothing was changed. Check your connection and try again.');
    } finally { showLoadingOverlay(false); }
    // Only clear the form on success. resetForm() used to run
    // unconditionally, so a failed edit wiped the admin's typing AND showed
    // an error telling them to try again — with nothing left to retry from.
    // The new-booking path further down already got this right; this one
    // did not.
    if (!editFailed) resetForm();
    renderTable(); renderActiveNow(); renderStatusGrid();
    return;
  }

  // Recurring edit — delete original, create new bookings for each date
  if (id && isRecurring) {
    const conflictDates = dates.filter(d => findConflict(room, d, start, end, id));
    if (conflictDates.length > 0) {
      showError(`Conflicts on ${conflictDates.length} date(s): ${conflictDates.slice(0, 3).map(fmtDate).join(', ')}${conflictDates.length > 3 ? '…' : ''}. Resolve conflicts first.`);
      return;
    }
    // ORDER MATTERS: create the replacements FIRST, delete the original LAST.
    //
    // This used to call apiDelete(id) up front. If the delete succeeded and
    // any subsequent apiCreate failed — network blip, rate limit, a trigger
    // rejection — the original booking was permanently gone with nothing in
    // its place, and no local rollback could reconstruct it.
    //
    // Creating first makes the worst case orphaned duplicates, which the
    // admin can see and delete, instead of an unrecoverable gap. The rule:
    // destructive operations go last.
    const createdRows = [];
    try {
      showLoadingOverlay(true);
      for (const d of dates) {
        const computedEndDate = minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(d, 1) : d;
        const booking = { id: genId(), room, booker, purpose, date: d, start, end, attendees: attendees || '', status: 'Confirmed', endDate: computedEndDate };
        await apiCreate(booking);
        createdRows.push(booking);
        bookings.push(booking);
      }
      // Every replacement is committed, so it is now safe to remove the original.
      await apiDelete(id);
      setBookings(bookings.filter(b => b.id !== id));
      toast(`Booking updated across ${dates.length} date(s).`);
    } catch (err) {
      // Best-effort cleanup of whatever we managed to create. If this also
      // fails the original is still intact, so the admin is left with
      // duplicates rather than a missing booking.
      for (const c of createdRows) {
        try { await apiDelete(c.id); } catch (_) {}
      }
      await loadData();
      showError('Could not update the recurring booking. The original has been left unchanged. The list was reloaded from the server — check it before retrying.');
    } finally { showLoadingOverlay(false); }
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
    let created = 0;
    let failed = false;
    try {
      showLoadingOverlay(true);
      for (const d of dates) {
        const computedEndDate = minutesSinceMidnight(end) < minutesSinceMidnight(start) ? addDaysStr(d, 1) : d;
        const booking = { id: genId(), room, booker, purpose, date: d, start, end, attendees: attendees || '', status: 'Confirmed', endDate: computedEndDate };
        bookings.push(booking);
        try {
          await apiCreate(booking);
          created++;
        } catch (err) {
          // ROLLBACK. The row was added to `bookings` optimistically so the
          // table updates instantly, but the insert failed — so remove it
          // again. Leaving it in place was the original bug: the booking
          // looked saved, survived until the next loadData(), then vanished
          // without trace because it had never reached the database.
          setBookings(bookings.filter(b => b.id !== booking.id));
          failed = true;
          throw err;
        }
      }
      toast(dates.length === 1 ? 'Room booked successfully.' : `${dates.length} recurring bookings created (Mon–Fri).`);
    } catch (err) {
      // Deliberately an in-form error, not a toast. A toast auto-dismisses
      // and is easy to miss, which is how failed saves went unnoticed.
      showError(created === 0
        ? 'The booking was NOT saved. Nothing has been created — check your connection and try again.'
        : `Only ${created} of ${dates.length} dates were saved. The unsaved dates have been removed from the list — retry those.`);
    } finally { showLoadingOverlay(false); }
    // Keep the form populated on failure so the admin doesn't have to retype
    // everything; only clear it once the save actually succeeded.
    if (!failed) resetForm();
    renderTable(); renderActiveNow(); renderStatusGrid();
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
    // Snapshot before the optimistic removal so a failed delete can be undone
    // — otherwise the row disappears from the table while still existing in
    // the database, and reappears on the next refresh.
    const prevBookings = [...bookings];
    setBookings(bookings.filter(b => b.id !== idToDelete));
    try {
      await apiDelete(idToDelete);
    } catch (err) {
      setBookings(prevBookings);
      throw err;
    }
    toast('Booking deleted.');
  } catch (e) {
    toast('Could not delete the booking — it is still there. Try again.', true);
  } finally {
    showLoadingOverlay(false);
  }
  renderTable();
  renderActiveNow();
  renderStatusGrid();
}

// ---- Bulk selection (admin table) ----
// Backed by state.js's selectedIds, NOT by the DOM. Only the current page's
// rows exist in the DOM, so a DOM-derived selection was silently truncated by
// pagination and by the 60-second poll re-rendering the table — while the
// bulk bar kept showing the pre-truncation count.
export function getSelectedIds() {
  // Prune as we read: a selected booking can be deleted by a bulk action, or
  // disappear on a refresh, and acting on an id that no longer exists just
  // produces a confusing failure.
  const live = new Set(bookings.map(b => b.id));
  let pruned = false;
  for (const id of selectedIds) {
    if (!live.has(id)) { selectedIds.delete(id); pruned = true; }
  }
  if (pruned) updateBulkBarLabel();
  return [...selectedIds];
}

function visibleRowCbs() {
  return Array.from(document.querySelectorAll('.row-cb'));
}

function updateBulkBarLabel() {
  const bar = document.getElementById('bulk-bar');
  const label = document.getElementById('bulk-count-label');
  if (!bar || !label) return;
  const total = selectedIds.size;
  if (total === 0) { bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  const onPage = visibleRowCbs().filter(cb => selectedIds.has(cb.dataset.id)).length;
  // Spell out when the selection reaches beyond this page, so a bulk action
  // never affects more rows than the admin can see.
  label.textContent = onPage === total
    ? `${total} selected`
    : `${total} selected (${onPage} on this page)`;
}

export function updateBulkBar() {
  updateBulkBarLabel();
  const cbs = visibleRowCbs();
  const selOnPage = cbs.filter(cb => selectedIds.has(cb.dataset.id)).length;
  const selAll = document.getElementById('select-all-cb');
  if (selAll) {
    // Reflects THIS PAGE only, matching what the header checkbox acts on.
    selAll.checked = cbs.length > 0 && selOnPage === cbs.length;
    selAll.indeterminate = selOnPage > 0 && selOnPage < cbs.length;
  }
}

export function onRowCbChange(cb) {
  if (cb && cb.dataset && cb.dataset.id) {
    if (cb.checked) selectedIds.add(cb.dataset.id);
    else selectedIds.delete(cb.dataset.id);
  } else {
    // Defensive: an older inline handler called this with no argument. Fall
    // back to reconciling the visible rows so the state can't drift.
    for (const c of visibleRowCbs()) {
      if (c.checked) selectedIds.add(c.dataset.id);
      else selectedIds.delete(c.dataset.id);
    }
  }
  updateBulkBar();
}

// Acts on the current page only. The label in index.html says "Select page"
// for that reason — a control that silently selected hundreds of off-screen
// rows would be worse than one with a clear scope.
export function toggleSelectAll(masterCb) {
  for (const cb of visibleRowCbs()) {
    cb.checked = masterCb.checked;
    if (masterCb.checked) selectedIds.add(cb.dataset.id);
    else selectedIds.delete(cb.dataset.id);
  }
  updateBulkBar();
}

export function clearBulkSelection() {
  setSelectedIds(new Set());
  visibleRowCbs().forEach(cb => cb.checked = false);
  const sa = document.getElementById('select-all-cb');
  if (sa) { sa.checked = false; sa.indeterminate = false; }
  updateBulkBar();
}

export async function bulkApprove() {
  const ids = getSelectedIds();
  if (ids.length === 0) return;

  // Two guards this function used to be missing, both of which
  // pending-list.js's bulkApprovePending() has always had:
  //
  //   1. STATUS FILTER. It offered "Approve" for every selected row, including
  //      rows already Confirmed — a pointless write that reported success.
  //   2. CONFLICT CHECK. approvePending() runs findConflict() and diverts to
  //      the conflict picker. This did neither, so bulk-approving a Rejected
  //      booking silently reinstated it straight into an occupied slot,
  //      bypassing a guard the single-approve path enforces. Two rejected
  //      bookings for the same room and time could both be confirmed.
  //
  // Rejected rows ARE approvable — reinstating a rejected request is a real
  // admin action — but they go through the same conflict check as Pending.
  const alreadyConfirmed = [];
  const candidates = [];
  for (const id of ids) {
    const b = bookings.find(x => x.id === id);
    if (!b) continue;
    if (b.status === 'Confirmed' || !b.status) alreadyConfirmed.push(b);
    else candidates.push(b);
  }

  if (candidates.length === 0) {
    toast(alreadyConfirmed.length
      ? `Nothing to approve — all ${alreadyConfirmed.length} selected booking(s) are already confirmed.`
      : 'Nothing to approve.', true);
    return;
  }

  let prompt = `Approve ${candidates.length} booking(s)?`;
  if (alreadyConfirmed.length > 0) {
    prompt += ` ${alreadyConfirmed.length} already confirmed and will be skipped.`;
  }
  if (!(await showConfirmModal(prompt, 'Approve All', 'btn-approve'))) return;

  // Split clean from conflicting, exactly as bulkApprovePending does.
  const cleanIds = [];
  const conflictItems = [];
  for (const b of candidates) {
    const conflict = findConflict(b.room, b.date, b.start, b.end, b.id);
    if (conflict) {
      conflictItems.push({ id: b.id, room: b.room, date: b.date, start: b.start,
                           end: b.end, booker: b.booker, purpose: b.purpose, conflict });
    } else {
      cleanIds.push(b.id);
    }
  }

  showLoadingOverlay(true);
  const prevStatuses = new Map(cleanIds.map(id => [id, bookings.find(b => b.id === id)?.status]));
  try {
    if (cleanIds.length > 0) {
      cleanIds.forEach(id => {
        const idx = bookings.findIndex(b => b.id === id);
        if (idx !== -1) bookings[idx].status = 'Confirmed';
      });
      await apiUpdateStatusBatch(cleanIds, 'Confirmed');
      notifyTeams({ event: 'batchApproved', count: cleanIds.length });
    }
    let msg = `${cleanIds.length} booking(s) approved.`;
    if (conflictItems.length > 0) msg += ` ${conflictItems.length} have conflicts — resolve below.`;
    if (alreadyConfirmed.length > 0) msg += ` ${alreadyConfirmed.length} skipped (already confirmed).`;
    toast(msg);
    clearBulkSelection();
  } catch (e) {
    // Restore each row's previous status — the batch update is atomic, so a
    // failure means none of them changed server-side.
    prevStatuses.forEach((status, id) => {
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1 && status) bookings[idx].status = status;
    });
    toast('Bulk approve failed — no bookings were changed.', true);
  }
  finally { showLoadingOverlay(false); }
  renderPendingRequests(); renderTable(); renderStatusGrid(); updatePendingDot();

  if (conflictItems.length > 0) openApprovalConflictModal(conflictItems);
}

export async function bulkCancel() {
  const allIds = getSelectedIds();
  if (allIds.length === 0) return;

  // Same reasoning as bulkApprove: cancelling something already Cancelled or
  // Rejected is a no-op write that reports success and tells the admin nothing.
  const skipped = [];
  const ids = [];
  for (const id of allIds) {
    const b = bookings.find(x => x.id === id);
    if (!b) continue;
    if (b.status === 'Cancelled' || b.status === 'Rejected') skipped.push(b);
    else ids.push(id);
  }
  if (ids.length === 0) {
    toast(`Nothing to cancel — all ${skipped.length} selected booking(s) are already cancelled or rejected.`, true);
    return;
  }

  let prompt = `Cancel ${ids.length} booking(s)?`;
  if (skipped.length > 0) prompt += ` ${skipped.length} already cancelled or rejected and will be skipped.`;
  if (!(await showConfirmModal(prompt, 'Cancel Bookings', 'btn-danger'))) return;
  showLoadingOverlay(true);
  try {
    await apiUpdateStatusBatch(ids, 'Cancelled');
    ids.forEach(id => {
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1) bookings[idx].status = 'Cancelled';
    });
    toast(`${ids.length} booking(s) cancelled.`);
    clearBulkSelection();
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
    clearBulkSelection();
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

  // bookings.length, not the filtered length: the point of this message is to
  // tell the admin the export is narrower than the full dataset — which now
  // includes rejected rows hidden by default.
  const totalCount = bookings.length;
  toast(rows.length === totalCount
    ? 'Excel file downloaded (' + rows.length + ' bookings).'
    : 'Excel file downloaded — ' + rows.length + ' of ' + totalCount + ' bookings (filters applied).');
}
