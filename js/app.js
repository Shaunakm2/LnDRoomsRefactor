// js/app.js — THE ENTRY POINT
// index.html loads this as: <script type="module" src="js/app.js"></script>
//
// CRITICAL: index.html has hundreds of inline onclick="functionName(...)"
// attributes. ES modules are scoped by default — a function inside a
// module is NOT automatically callable from an inline onclick anymore.
// Every single handler referenced anywhere in index.html's onclick/
// onchange/onkeydown attributes MUST be explicitly exposed on `window`
// below, or that button/input silently stops working with no error.
// If you add a new onclick in index.html later, add its function here too.

import { bookings, adminLoggedIn, setAdminLoggedIn, setSessionToken } from './state.js';
import { todayStr } from './domain/time.js';
import { toast, updateClock } from './utils/dom-helpers.js';
import { loadData } from './api/supabase-client.js';
import { doLogin, doLogout, closeLogin, requireAdmin } from './api/auth.js';
import { notifyTeams } from './api/notifications.js';

import { showPage } from './ui/pages.js';
import { renderStatusGrid } from './ui/status-grid.js';
import {
  renderTable, goToPage, renderActiveNow, adminReleaseEarly,
  populateRoomSelects, updateFCapacityHint, resetForm, editBooking,
  showError, toggleRecurring, submitBooking, deleteBooking, confirmDelete,
  getSelectedIds, updateBulkBar, onRowCbChange, toggleSelectAll,
  clearBulkSelection, bulkApprove, bulkCancel, bulkDelete, exportExcel,
} from './ui/admin-table.js';
import {
  updatePendingDot, renderPendingRequests, toggleModifyForm, approvePending,
  modifyAndApprove, openRejectModal, confirmReject, getPendingSelectedIds,
  updatePendingBulkBar, onPendingCbChange, togglePendingSelectAll,
  clearPendingSelection, bulkApprovePending, bulkRejectPending,
} from './ui/pending-list.js';
import {
  openConflictModal, selectAlt, selectApprovalResolution,
  openApprovalConflictModal, closeConflictModal, confirmConflictResolution,
} from './ui/conflict-picker.js';
import {
  openRequestModal, closeRequestModal, validateReqTimes, toggleReqRecurring,
  updateReqCapacityHint, submitRequest,
} from './ui/request-form.js';
import { openSchedModal, closeSchedModal, closeSchedIfBg } from './ui/schedule-modal.js';
import { openCancelModal, openReleaseModal, closeCancelModal, confirmCancelOrRelease } from './ui/cancel-release.js';
import {
  renderTimeline, showTlTooltip, hideTlTooltip, hideTlTooltipDelayed,
  setTimelineDay, shiftTimelineDay, toggleTimeline, initTimelineListeners,
} from './ui/timeline.js';
import { toggleSunflowerFaq, toggleSunflowerHelp, initSunflowerListeners } from './ui/sunflower-help.js';
import { showConfirmModal, resolveConfirmModal } from './utils/dom-helpers.js';

// toggleConflictResolved lives conceptually with conflicts, but touches
// state/UI directly — kept here rather than in domain/conflicts.js to
// avoid that file needing UI-layer imports.
import { getLiveConflicts } from './domain/conflicts.js';
import { apiSetConflictResolved } from './api/bookings.js';

let _resolveConflictBookingId = null;

async function toggleConflictResolved(bookingId) {
  const b = bookings.find(x => x.id === bookingId);
  if (!b) return;

  if (b.conflictResolved) {
    const prevNote = b.conflictNote;
    b.conflictResolved = false;
    b.conflictNote = '';
    renderPendingRequests(); renderTable(); renderStatusGrid();
    try {
      await apiSetConflictResolved(bookingId, false, '');
      toast('Conflict warning restored.');
    } catch (e) {
      b.conflictResolved = true; b.conflictNote = prevNote;
      renderPendingRequests(); renderTable(); renderStatusGrid();
      toast('Could not update — check connection.', true);
    }
    return;
  }

  _resolveConflictBookingId = bookingId;
  const liveConflicts = getLiveConflicts(b);
  const { fmtTime, fmtDate } = await import('./utils/formatting.js');
  const thisOne = `${b.booker}, ${fmtTime(b.start)}–${fmtTime(b.end)} on ${fmtDate(b.date)}`;
  const otherOnes = liveConflicts.map(c => `${c.booker}, ${fmtTime(c.start)}–${fmtTime(c.end)} on ${fmtDate(c.date)} (${c.status})`).join('\n');
  document.getElementById('resolve-conflict-details').textContent = `Resolving conflict for:\n  ${thisOne}\nagainst:\n  ${otherOnes}`;
  document.getElementById('resolve-conflict-note').value = b.conflictNote || '';
  document.getElementById('resolve-conflict-modal').style.display = 'flex';
}

function closeResolveConflictModal() {
  document.getElementById('resolve-conflict-modal').style.display = 'none';
  _resolveConflictBookingId = null;
}

async function confirmResolveConflict() {
  const bookingId = _resolveConflictBookingId;
  const b = bookings.find(x => x.id === bookingId);
  if (!b) { closeResolveConflictModal(); return; }
  const trimmedNote = document.getElementById('resolve-conflict-note').value.trim();
  closeResolveConflictModal();
  b.conflictResolved = true;
  b.conflictNote = trimmedNote;
  renderPendingRequests(); renderTable(); renderStatusGrid();
  try {
    await apiSetConflictResolved(bookingId, true, trimmedNote);
    toast('Marked as resolved.');
  } catch (e) {
    b.conflictResolved = false; b.conflictNote = '';
    renderPendingRequests(); renderTable(); renderStatusGrid();
    toast('Could not update — check connection.', true);
  }
}

// ============================================================
// EXPOSE every function referenced by an inline onclick/onchange/onkeydown
// in index.html. Names on the left MUST match exactly what index.html calls.
// ============================================================
Object.assign(window, {
  // pages / auth
  showPage, doLogin, doLogout, closeLogin, requireAdmin,
  // status grid / timeline / schedule
  renderStatusGrid, renderTimeline, showTlTooltip, hideTlTooltip, hideTlTooltipDelayed,
  setTimelineDay, shiftTimelineDay, toggleTimeline,
  openSchedModal, closeSchedModal, closeSchedIfBg,
  // request form
  openRequestModal, closeRequestModal, validateReqTimes, toggleReqRecurring,
  updateReqCapacityHint, submitRequest,
  // cancel/release
  openCancelModal, openReleaseModal, closeCancelModal, confirmCancelOrRelease,
  // admin table
  renderTable, goToPage, renderActiveNow, adminReleaseEarly,
  populateRoomSelects, updateFCapacityHint, resetForm, editBooking,
  showError, toggleRecurring, submitBooking, deleteBooking, confirmDelete,
  getSelectedIds, updateBulkBar, onRowCbChange, toggleSelectAll,
  clearBulkSelection, bulkApprove, bulkCancel, bulkDelete, exportExcel,
  // pending list
  updatePendingDot, renderPendingRequests, toggleModifyForm, approvePending,
  modifyAndApprove, openRejectModal, confirmReject, getPendingSelectedIds,
  updatePendingBulkBar, onPendingCbChange, togglePendingSelectAll,
  clearPendingSelection, bulkApprovePending, bulkRejectPending,
  // conflict picker
  openConflictModal, selectAlt, selectApprovalResolution,
  openApprovalConflictModal, closeConflictModal, confirmConflictResolution,
  // conflict-resolved toggle (defined in this file)
  toggleConflictResolved, closeResolveConflictModal, confirmResolveConflict,
  // sunflower
  toggleSunflowerFaq, toggleSunflowerHelp,
  // generic confirm modal — NOTE: index.html's button almost certainly
  // calls this with its ORIGINAL underscore-prefixed name from before the
  // refactor. Exposed under BOTH names so it works regardless of which
  // one index.html actually has, without needing to also edit the HTML.
  showConfirmModal,
  _resolveConfirmModal: resolveConfirmModal,
  resolveConfirmModal,
});

// ============================================================
// Session timeout (30 min inactivity, 5 min warning) — needs
// showPage/toast/state setters together, kept here rather than in
// state.js to avoid a circular import.
// ============================================================
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000;
let _lastActivityAt = Date.now();
let _sessionWarningShown = false;
function _touchActivity() {
  _lastActivityAt = Date.now();
  _sessionWarningShown = false;
}
document.addEventListener('click', _touchActivity);
document.addEventListener('keydown', _touchActivity);
setInterval(() => {
  if (!adminLoggedIn) return;
  const idleFor = Date.now() - _lastActivityAt;
  if (idleFor > SESSION_TIMEOUT_MS) {
    setAdminLoggedIn(false);
    setSessionToken(null);
    _sessionWarningShown = false;
    document.getElementById('logout-btn').style.display = 'none';
    showPage('status');
    toast('Session expired. Please log in again.');
  } else if (idleFor > SESSION_TIMEOUT_MS - SESSION_WARNING_MS && !_sessionWarningShown) {
    _sessionWarningShown = true;
    toast('Your session will expire in 5 minutes due to inactivity — click anywhere to stay logged in.', false, 7000);
  }
}, 60000);

window.addEventListener('beforeunload', e => {
  const booker = document.getElementById('f-booker')?.value;
  if (booker && adminLoggedIn) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ============================================================
// INIT
// ============================================================
async function init() {
  populateRoomSelects();
  document.getElementById('f-date').value = todayStr();
  updateClock();
  setInterval(updateClock, 1000);
  await loadData();
  updatePendingDot();
  renderStatusGrid();
  renderTimeline();
  initSunflowerListeners();
  initTimelineListeners();

  setInterval(async () => {
    if (document.hidden) return;
    await loadData(true);
    updatePendingDot();
    if (document.getElementById('page-status').classList.contains('active')) {
      renderStatusGrid();
      const tlWrap = document.getElementById('timeline-wrap');
      if (tlWrap && tlWrap.style.display !== 'none') renderTimeline();
    }
    if (document.getElementById('page-admin').classList.contains('active')) {
      renderTable();
      renderActiveNow();
      renderPendingRequests();
    }
  }, 60000);

  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      await loadData(true);
      updatePendingDot();
      if (document.getElementById('page-status').classList.contains('active')) renderStatusGrid();
      if (document.getElementById('page-admin').classList.contains('active')) {
        renderTable(); renderActiveNow(); renderPendingRequests();
      }
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.error('Service worker registration failed:', err);
    });
  }
}

init();
