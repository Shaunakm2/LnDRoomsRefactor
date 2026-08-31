// js/ui/schedule-modal.js
// Per-room 60-day schedule (30 past + 30 future). Auto-scrolls to today
// on open rather than starting at the 30-days-ago end.

import { ROOMS } from '../config.js';
import { bookings } from '../state.js';
import { todayStr, nowMinutes, localDateStr, isOvernight, bookingSpans } from '../domain/time.js';
import { fmtTime, displayPurpose } from '../utils/formatting.js';
import { escHtml } from '../utils/dom-helpers.js';
import { roomBadgesHtml } from './status-grid.js';

export function openSchedModal(roomId) {
  const room = ROOMS.find(r => r.id === roomId);
  if (!room) return;
  document.getElementById('sched-modal-room').innerHTML = escHtml(room.name + ' — ' + room.floor) + roomBadgesHtml(room);
  const body = document.getElementById('sched-modal-body');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let html = '';

  for (let i = -30; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const ds = localDateStr(d);
    const dayName = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    const isToday = i === 0;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const dayBookings = bookings
      .filter(b => (b.status === 'Confirmed' || !b.status) && b.room === roomId)
      .map(b => ({ b, span: bookingSpans(b).find(sp => sp.date === ds) }))
      .filter(x => x.span)
      .sort((a, c) => a.span.start - c.span.start);

    let dayHtml = '';
    if (dayBookings.length === 0) {
      dayHtml = '<div class="sched-free-all">Fully available all day</div>';
    } else {
      for (const { b, span } of dayBookings) {
        const isPast = ds < todayStr() || (ds === todayStr() && span.end <= nowMinutes());
        const overnightNote = isOvernight(b)
          ? (span.start === 0
              ? ' <span style="color:var(--text-faint);font-size:11px">(cont. from prev. day)</span>'
              : ' <span style="color:var(--text-faint);font-size:11px">(continues next day)</span>')
          : '';
        dayHtml += '<div class="sched-slot booked" style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:12px;flex:1">' +
          '<div class="sched-slot-time">' + fmtTime(b.start) + ' – ' + fmtTime(b.end) + overnightNote + '</div>' +
          '<div class="sched-slot-info">' +
            '<div class="sched-slot-booker">' + escHtml(b.booker) + '</div>' +
            (b.purpose ? '<div class="sched-slot-purpose">' + escHtml(displayPurpose(b.purpose)) + (b.attendees ? ' &middot; ' + b.attendees + ' attendees' : '') + '</div>' : '') +
          '</div></div>' +
          (!isPast ? '<button class="btn btn-danger btn-sm" style="flex-shrink:0;font-size:11px;padding:4px 10px" onclick="event.stopPropagation();openCancelModal(\'' + b.id + '\')" title="Cancel this booking">Cancel</button>' : '') +
        '</div>';
      }
    }

    const labelClass = isToday ? 'sched-day-label today-label' : 'sched-day-label';
    const todayTag = isToday ? ' &mdash; Today' : '';
    const weekendTag = isWeekend ? ' <span style="color:var(--text-faint);font-weight:400">(Weekend)</span>' : '';

    html += '<div class="sched-day-group"' + (isToday ? ' id="sched-today-anchor"' : '') + '>' +
      '<div class="' + labelClass + '">' + dayName + todayTag + weekendTag + '</div>' +
      dayHtml +
    '</div>';
  }

  body.innerHTML = html;
  document.getElementById('sched-modal').style.display = 'flex';
  requestAnimationFrame(() => {
    document.getElementById('sched-today-anchor')?.scrollIntoView({ block: 'center' });
  });
}

export function closeSchedModal() {
  document.getElementById('sched-modal').style.display = 'none';
}

export function closeSchedIfBg(e) {
  if (e.target === document.getElementById('sched-modal')) closeSchedModal();
}
