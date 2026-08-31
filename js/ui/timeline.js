// js/ui/timeline.js
// The 24-hour bar timeline. Each booking's onscreen position comes
// straight from bookingSpans() — that's why overnight bookings correctly
// split across two day-columns automatically, no special-casing here.

import { ROOMS } from '../config.js';
import { bookings, timelineDay, setTimelineDay as setTimelineDayState } from '../state.js';
import { todayStr, nowMinutes, addDaysStr, bookingSpans } from '../domain/time.js';
import { fmtTime, displayPurpose } from '../utils/formatting.js';
import { escHtml } from '../utils/dom-helpers.js';

// ---- Tooltip ----
let _tlTooltipTimeout = null;

export function showTlTooltip(e, el) {
  if (_tlTooltipTimeout) { clearTimeout(_tlTooltipTimeout); _tlTooltipTimeout = null; }
  const tip = document.getElementById('tl-tooltip');
  document.getElementById('tl-tip-room').textContent = el.dataset.booker || '';
  document.getElementById('tl-tip-time').textContent = el.dataset.time || '';
  document.getElementById('tl-tip-purpose').textContent = el.dataset.purpose || '';
  const att = el.dataset.att;
  document.getElementById('tl-tip-att').textContent = att ? att + ' attendees' : '';

  const isTouchEvt = e.type === 'touchstart';
  const clientX = isTouchEvt ? e.touches[0].clientX : e.clientX;
  const clientY = isTouchEvt ? e.touches[0].clientY : e.clientY;

  tip.classList.add('visible');

  requestAnimationFrame(() => {
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = clientX + 12;
    let top = clientY - th / 2;
    if (left + tw > vw - 8) left = clientX - tw - 12;
    if (top < 8) top = 8;
    if (top + th > vh - 8) top = vh - th - 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });

  if (isTouchEvt) _tlTooltipTimeout = setTimeout(hideTlTooltip, 3000);
}

export function hideTlTooltip() {
  if (_tlTooltipTimeout) { clearTimeout(_tlTooltipTimeout); _tlTooltipTimeout = null; }
  document.getElementById('tl-tooltip').classList.remove('visible');
}

export function hideTlTooltipDelayed() {
  _tlTooltipTimeout = setTimeout(hideTlTooltip, 2800);
}

// ---- Day navigation ----
export function getTimelineTargetDate() {
  const today = todayStr();
  if (timelineDay === 'yesterday') return addDaysStr(today, -1);
  if (timelineDay === 'tomorrow') return addDaysStr(today, 1);
  if (timelineDay === 'custom') {
    const cv = document.getElementById('tl-custom-date')?.value;
    return cv || today;
  }
  return today;
}

// ---- Main render ----
export function renderTimeline() {
  const container = document.getElementById('tl-bar-inner');
  if (!container) return;

  const today = todayStr();
  const now = nowMinutes();
  const DAY_MINS = 1440;

  const targetDate = getTimelineTargetDate();
  const isToday = targetDate === today;

  const TICK_HOURS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
  const tickLabels = TICK_HOURS.map(h => {
    const label = h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
    const leftPct = (h * 60 / DAY_MINS) * 100;
    return `<div class="tl-ruler-tick" style="position:absolute;left:${leftPct}%">${label}</div>`;
  }).join('');

  let gridHtml = '';
  for (let h = 1; h < 24; h++) {
    const leftPct = (h / 24) * 100;
    gridHtml += `<div style="position:absolute;top:0;bottom:0;left:${leftPct}%;width:1px;background:rgba(0,0,0,0.06);"></div>`;
  }

  const nowPct = (now / DAY_MINS) * 100;

  const tlFloorFilter = document.getElementById('floor-filter')?.value || '';
  let rowsHtml = '';
  for (const room of ROOMS) {
    if (tlFloorFilter && room.floor !== tlFloorFilter) continue;
    const roomBookings = bookings.filter(b =>
      b.room === room.id && (b.status === 'Confirmed' || !b.status)
    );

    let blocksHtml = '';
    for (const b of roomBookings) {
      const spans = bookingSpans(b).filter(s => s.date === targetDate);
      for (const span of spans) {
        const leftPct = (span.start / DAY_MINS) * 100;
        const widthPct = ((span.end - span.start) / DAY_MINS) * 100;
        const cls = 'confirmed';
        const startFmt = fmtTime(b.start);
        const endFmt = fmtTime(b.end);
        const showLabel = widthPct > 3;
        const showTime = widthPct > 7;
        blocksHtml += `<div class="tl-booking-block ${cls}"
          style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%"
          data-booker="${escHtml(b.booker)}"
          data-time="${startFmt}–${endFmt}"
          data-purpose="${escHtml(displayPurpose(b.purpose) || '')}"
          data-att="${escHtml(b.attendees || '')}"
          onmouseenter="showTlTooltip(event,this)"
          onmouseleave="hideTlTooltip()"
          ontouchstart="showTlTooltip(event,this)"
          ontouchend="hideTlTooltipDelayed()">
          ${showLabel ? `<div>
            <div class="tl-booking-label">${escHtml(b.booker)}</div>
            ${showTime ? `<div class="tl-booking-time">${startFmt}–${endFmt}</div>` : ''}
          </div>` : ''}
        </div>`;
      }
    }

    const nowLineHtml = isToday
      ? `<div class="tl-now-line" style="left:${nowPct.toFixed(3)}%"><div class="tl-now-dot"></div></div>`
      : '';

    rowsHtml += `<div class="tl-row">
      <div class="tl-room-label">
        ${escHtml(room.name)}
        <div class="tl-room-floor-label">${escHtml(room.floor)}</div>
      </div>
      <div class="tl-track">
        ${gridHtml}
        ${blocksHtml}
        ${nowLineHtml}
      </div>
    </div>`;
  }

  container.innerHTML = `
    <div style="position:relative;margin-left:130px;margin-right:14px;height:18px;margin-bottom:2px;">
      ${tickLabels}
    </div>
    ${rowsHtml}
  `;

  if (isToday) {
    const barContainer = document.querySelector('.tl-bar-container');
    if (barContainer) {
      const scrollPct = Math.max(0, (nowPct / 100) - 0.2);
      barContainer.scrollLeft = barContainer.scrollWidth * scrollPct;
    }
  }
}

export function setTimelineDay(day, event) {
  if (event) event.stopPropagation();
  setTimelineDayState(day);
  document.querySelectorAll('.tl-tab').forEach(t => t.classList.remove('tl-tab-active'));
  if (day !== 'custom' && event && event.target) event.target.classList.add('tl-tab-active');
  const wrap = document.getElementById('timeline-wrap');
  const icon = document.getElementById('timeline-toggle-icon');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    icon.style.transform = 'rotate(0deg)';
  }
  renderTimeline();
}

// Previous/Next buttons — shift relative to whichever date is CURRENTLY
// shown (not always relative to today), so repeated clicks keep walking
// forward/back one day at a time from wherever the user currently is.
export function shiftTimelineDay(delta) {
  const current = getTimelineTargetDate();
  const newDate = addDaysStr(current, delta);
  const today = todayStr();
  const yestStr = addDaysStr(today, -1);
  const tomStr = addDaysStr(today, 1);

  document.querySelectorAll('.tl-tab').forEach(t => t.classList.remove('tl-tab-active'));
  document.getElementById('tl-custom-date').value = newDate;

  if (newDate === yestStr) {
    setTimelineDayState('yesterday');
    document.getElementById('tl-tab-yesterday')?.classList.add('tl-tab-active');
  } else if (newDate === today) {
    setTimelineDayState('today');
    document.getElementById('tl-tab-today')?.classList.add('tl-tab-active');
  } else if (newDate === tomStr) {
    setTimelineDayState('tomorrow');
    document.getElementById('tl-tab-tomorrow')?.classList.add('tl-tab-active');
  } else {
    setTimelineDayState('custom');
  }

  const wrap = document.getElementById('timeline-wrap');
  const icon = document.getElementById('timeline-toggle-icon');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    icon.style.transform = 'rotate(0deg)';
  }
  renderTimeline();
}

export function toggleTimeline() {
  const wrap = document.getElementById('timeline-wrap');
  const icon = document.getElementById('timeline-toggle-icon');
  const isHidden = wrap.style.display === 'none';
  wrap.style.display = isHidden ? 'block' : 'none';
  icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
  if (isHidden) renderTimeline();
}

// Hide tooltip on scroll (important for mobile). Wrapped in an init
// function so app.js controls when this attaches, matching the same
// pattern used for the sunflower panel's listeners.
export function initTimelineListeners() {
  document.addEventListener('scroll', hideTlTooltip, true);
}
