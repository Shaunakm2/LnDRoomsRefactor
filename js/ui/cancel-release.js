// js/ui/cancel-release.js
// Public self-service cancel/release. "Verification" is just typing the
// booker's name — which is also visible on the same public schedule page,
// so this is really a friction-against-mistakes feature, not hard
// authorization. That's a known, documented tradeoff (see the project's
// security notes) — compensated for by every self-service action posting
// a Teams audit notification, so misuse is visible even though it isn't
// prevented outright.

import { bookings } from '../state.js';
import { todayStr } from '../domain/time.js';
import { bookingTimeStatus } from '../domain/filters-sort.js';
import { fmtDate, fmtTime, displayPurpose } from '../utils/formatting.js';
import { escHtml, toast, showLoadingOverlay } from '../utils/dom-helpers.js';
import { roomName } from '../config.js';
import { apiCancelOwn, apiReleaseOwn } from '../api/bookings.js';
import { notifyTeams } from '../api/notifications.js';
import { renderStatusGrid } from './status-grid.js';
import { renderTable, renderActiveNow } from './admin-table.js';
import { renderPendingRequests, updatePendingDot } from './pending-list.js';
import { closeSchedModal } from './schedule-modal.js';

let _cancelBookingId = null;
let _cancelModalMode = 'cancel'; // 'cancel' or 'release'

export function openCancelModal(bookingId) {
  const b = bookings.find(x => x.id === bookingId);
  if (!b) return;
  _cancelBookingId = bookingId;
  _cancelModalMode = 'cancel';
  document.getElementById('cancel-modal-title').textContent = 'Cancel Your Booking';
  document.getElementById('cancel-modal-sub').textContent = 'Enter your name to verify and cancel your booking.';
  const confirmBtn = document.getElementById('cancel-modal-confirm-btn');
  confirmBtn.textContent = 'Cancel My Booking';
  confirmBtn.className = 'btn btn-danger';
  document.getElementById('cancel-booking-card').innerHTML =
    '<div class="room-name">' + escHtml(roomName(b.room)) + '</div>' +
    '<div class="meta">' + fmtDate(b.date) + ' &middot; ' + fmtTime(b.start) + ' – ' + fmtTime(b.end) +
    (b.purpose ? ' &middot; ' + escHtml(displayPurpose(b.purpose)) : '') + '</div>';
  document.getElementById('cancel-name-input').value = '';
  document.getElementById('cancel-error').classList.remove('visible');
  document.getElementById('sched-modal').style.display = 'none';
  document.getElementById('cancel-modal').style.display = 'flex';
}

// Same name-verification model as cancel — but ends the booking NOW
// instead of at its scheduled time, freeing the room immediately.
export function openReleaseModal(bookingId) {
  const b = bookings.find(x => x.id === bookingId);
  if (!b) return;
  _cancelBookingId = bookingId;
  _cancelModalMode = 'release';
  document.getElementById('cancel-modal-title').textContent = 'Release Room Early';
  document.getElementById('cancel-modal-sub').textContent = 'Enter your name to verify and free this room right now.';
  const confirmBtn = document.getElementById('cancel-modal-confirm-btn');
  confirmBtn.textContent = 'Release Room Now';
  confirmBtn.className = 'btn btn-approve';
  document.getElementById('cancel-booking-card').innerHTML =
    '<div class="room-name">' + escHtml(roomName(b.room)) + '</div>' +
    '<div class="meta">' + fmtDate(b.date) + ' &middot; ' + fmtTime(b.start) + ' – ' + fmtTime(b.end) +
    (b.purpose ? ' &middot; ' + escHtml(displayPurpose(b.purpose)) : '') + '</div>';
  document.getElementById('cancel-name-input').value = '';
  document.getElementById('cancel-error').classList.remove('visible');
  document.getElementById('cancel-modal').style.display = 'flex';
}

export function closeCancelModal() {
  document.getElementById('cancel-modal').style.display = 'none';
  _cancelBookingId = null;
  // Reopen schedule modal so the user can keep browsing — only relevant
  // for the cancel flow, which is always entered from within it. Release
  // is opened directly from the room card, so there's nothing to return to.
  if (_cancelModalMode === 'cancel') {
    document.getElementById('sched-modal').style.display = 'flex';
  }
}

export async function confirmCancelOrRelease() {
  const b = bookings.find(x => x.id === _cancelBookingId);
  if (!b) return;
  const entered = document.getElementById('cancel-name-input').value.trim().toLowerCase();
  const actual = b.booker.trim().toLowerCase();
  if (entered !== actual) {
    document.getElementById('cancel-error').classList.add('visible');
    return;
  }
  document.getElementById('cancel-error').classList.remove('visible');
  try {
    showLoadingOverlay(true);
    if (_cancelModalMode === 'release') {
      if (bookingTimeStatus(b) !== 'active') {
        toast('This booking is no longer active.', true);
        closeCancelModal();
        return;
      }
      // Use the ACTUAL current date (not the booking's original date) for
      // endDate — correct whether released on its start day or, for an
      // overnight booking, on its continuation day after midnight.
      const now = new Date();
      const nowHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      await apiReleaseOwn(b.id, entered, nowHHMM + ':00', todayStr());
      b.end = nowHHMM;
      b.endDate = todayStr();
      closeCancelModal();
      toast('Room released — now available.');
      notifyTeams({ event: 'releasedBySelf', room: roomName(b.room), bookedBy: b.booker, purpose: b.purpose, date: b.date, start: fmtTime(b.start), end: fmtTime(nowHHMM) });
    } else {
      // Server re-verifies the name match — the client-side check above
      // is a UX nicety, not the real security boundary.
      await apiCancelOwn(_cancelBookingId, entered);
      const idx = bookings.findIndex(x => x.id === _cancelBookingId);
      if (idx !== -1) bookings[idx].status = 'Cancelled';
      closeCancelModal();
      closeSchedModal();
      toast('Booking cancelled successfully.');
      notifyTeams({ event: 'cancelledBySelf', room: roomName(b.room), bookedBy: b.booker, purpose: b.purpose, date: b.date, start: fmtTime(b.start), end: fmtTime(b.end) });
    }
    renderStatusGrid();
    updatePendingDot();
    if (document.getElementById('page-admin').classList.contains('active')) {
      renderTable(); renderActiveNow(); renderPendingRequests();
    }
  } catch (e) {
    toast('Error — please try again.', true);
  } finally {
    showLoadingOverlay(false);
  }
  _cancelBookingId = null;
}
