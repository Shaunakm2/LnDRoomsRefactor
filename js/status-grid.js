// js/ui/status-grid.js
// The room cards on the public "Room Status" page. Each card is a
// different lens on getRoomStatus() — status badge, capacity/equipment
// badges, and the multi-occupant body (a room can legitimately have more
// than one active booking when an admin resolved a conflict and let two
// people share it — see domain/room-status.js for why that matters).

import { ROOMS } from '../config.js';
import { bookings } from '../state.js';
import { getRoomStatus } from '../domain/room-status.js';
import { todayStr, bookingSpans } from '../domain/time.js';
import { fmtTime, displayPurpose } from '../utils/formatting.js';
import { escHtml } from '../utils/dom-helpers.js';
import { renderTimeline } from './timeline.js';

function equipmentIconSvg(equipment) {
  if (equipment === 'TV') {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>';
  }
  if (equipment === 'Projector') {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="13" height="8" rx="2"/><circle cx="8.5" cy="12" r="2.4"/><path d="M17 8.5l4-2M17 12h5M17 15.5l4 2"/></svg>';
  }
  if (equipment === 'Interactive Panel') {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><circle cx="17" cy="10" r="1.1" fill="currentColor" stroke="none"/></svg>';
  }
  return '';
}

export function roomBadgesHtml(room, size) {
  if (!room) return '';
  const cls = size === 'sm' ? 'capacity-badge sm' : 'capacity-badge';
  const capHtml = room.capacity
    ? `<span class="${cls}" title="Seats up to ${room.capacity} people">${room.capacity}</span>` : '';
  const eqHtml = room.equipment
    ? `<span class="equipment-badge" title="${escHtml(room.equipment)}">${equipmentIconSvg(room.equipment)}</span>` : '';
  if (!capHtml && !eqHtml) return '';
  return `<span class="room-badges">${capHtml}${eqHtml}</span>`;
}

export function renderStatusGrid() {
  const grid = document.getElementById('rooms-grid');
  const today = new Date();
  document.getElementById('status-date').textContent =
    today.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let freeCount = 0, occCount = 0, soonCount = 0;
  let html = '';
  const floorFilter = document.getElementById('floor-filter')?.value || '';

  for (const room of ROOMS) {
    if (floorFilter && room.floor !== floorFilter) continue;
    const { status, activeEntries, nextBookings } = getRoomStatus(room.id);
    if (status === 'free') freeCount++;
    else if (status === 'occupied') occCount++;
    else soonCount++;

    let badgeClass, badgeText, cardClass;
    if (status === 'free') {
      badgeClass = 'badge-free'; badgeText = 'Available'; cardClass = 'free';
    } else if (status === 'soon') {
      badgeClass = 'badge-soon'; badgeText = 'Ending Soon'; cardClass = 'ending-soon';
    } else {
      badgeClass = 'badge-occupied'; badgeText = 'In Use'; cardClass = 'occupied';
    }

    const roomColor = room.color || '#5B4FCF';
    const roomLight = room.colorLight || '#EDE8FF';
    const roomBorder = roomColor + '18';
    const roomShadow = roomColor + '18';

    let bodyHtml = '';
    if (activeEntries.length > 0) {
      activeEntries.forEach((entry, idx) => {
        const { booking, info } = entry;
        const mins = info.total - info.elapsed;
        const entryPct = Math.min(100, Math.round((info.elapsed / info.total) * 100));
        const entryBarClass = mins <= 30 ? 'warn' : '';
        const freeAt = fmtTime(booking.end);

        if (idx > 0) bodyHtml += `<div class="room-occupant-divider"></div>`;
        bodyHtml += `
          <div class="room-info-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span class="room-booker">${escHtml(booking.booker)}</span>
          </div>`;
        if (booking.purpose) {
          bodyHtml += `<div class="room-info-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${escHtml(displayPurpose(booking.purpose))}</span>
          </div>`;
        }
        if (booking.conflictResolved && booking.conflictNote) {
          bodyHtml += `<div class="room-info-row" style="color:var(--text-muted);font-size:12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span>${escHtml(booking.conflictNote)}</span>
          </div>`;
        }
        bodyHtml += `<div class="room-info-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Free at <strong>${freeAt}</strong> &mdash; ${mins} min remaining</span>
          </div>`;
        bodyHtml += `<div class="room-time-bar"><div class="room-time-fill ${entryBarClass}" style="width:${entryPct}%"></div></div>`;
        bodyHtml += `<div class="room-time-label">${fmtTime(booking.start)} – ${fmtTime(booking.end)}</div>`;
        bodyHtml += `<button class="btn-release-early" onclick="openReleaseModal('${booking.id}')">Release ${escHtml(booking.booker)}'s Booking</button>`;
      });
    } else {
      const nextToday = nextBookings[0];
      const today_ = todayStr();
      const hasAnyBookingToday = bookings.some(b =>
        b.room === room.id && b.status === 'Confirmed' &&
        bookingSpans(b).some(s => s.date === today_));
      const isSleepy = status === 'free' && !hasAnyBookingToday;
      const freeUntilText = nextToday
        ? `Free until ${fmtTime(nextToday.start)}`
        : hasAnyBookingToday
          ? 'Free for the rest of today'
          : 'Free all day' + (isSleepy ? ' <span class="zzz-badge" title="No bookings today">Zzz</span>' : '');
      bodyHtml += `<div class="room-info-row" style="color:var(--text);font-weight:500;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>${freeUntilText}</span>
      </div>`;
      bodyHtml += `<div class="room-time-bar"><div class="room-time-fill free" style="width:0%"></div></div>`;
      bodyHtml += `<div class="room-time-label">&nbsp;</div>`;
    }

    if (nextBookings.length > 0) {
      const nb = nextBookings[0];
      bodyHtml += `<div class="next-booking-note">
        Next: <strong>${escHtml(nb.booker)}</strong> at ${fmtTime(nb.start)}
        ${nb.purpose ? '&mdash; ' + escHtml(displayPurpose(nb.purpose)) : ''}
      </div>`;
    }

    const pendingForRoom = bookings.filter(b => b.room === room.id && b.status === 'Pending').length;
    const pendingTag = pendingForRoom > 0 ? `<span style="font-size:11px;background:var(--warn-light);color:var(--warn);padding:2px 7px;border-radius:999px;font-weight:600;margin-left:6px;">${pendingForRoom} pending</span>` : '';

    html += `<div class="room-card ${cardClass}" style="--room-color:${roomColor};--room-bg:${roomLight};--room-border:${roomBorder};--room-shadow:${roomShadow};">
      <div class="room-card-top" onclick="openSchedModal('${room.id}')" title="Click to view 30-day schedule" style="cursor:pointer">
        <div>
          <div class="room-name">${escHtml(room.name)}${pendingTag}</div>
          <div class="room-floor">${escHtml(room.floor)}${roomBadgesHtml(room)}</div>
        </div>
        <span class="status-badge ${badgeClass}">${badgeText}</span>
      </div>
      ${bodyHtml}
      <button class="btn-request" onclick="openRequestModal('${room.id}')">+ Request a Booking</button>
    </div>`;
  }

  grid.innerHTML = html;
  document.getElementById('count-free').textContent = freeCount + ' available';
  document.getElementById('count-occ').textContent = occCount + ' occupied';
  document.getElementById('count-soon').textContent = soonCount + ' ending soon';

  const total = ROOMS.length;
  const occEl = document.getElementById('occupancy-counter');
  if (occEl) {
    occEl.textContent = freeCount + '/' + total + ' Available';
    occEl.style.color = freeCount > total / 2 ? 'var(--ok)' : freeCount > 0 ? 'var(--warn)' : 'var(--danger)';
  }

  // Only re-render timeline if it's expanded
  const tlWrap = document.getElementById('timeline-wrap');
  if (tlWrap && tlWrap.style.display !== 'none') renderTimeline();
}
