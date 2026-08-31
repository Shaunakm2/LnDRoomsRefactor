// js/utils/dom-helpers.js
// Pure DOM-manipulation helpers. No dependency on `bookings` or any other
// module's state.

import { pad } from './formatting.js';

const LOADING_MESSAGES = [
  'Please wait...',
  'Counting chairs...',
  'Waking up the rooms...',
  'Herding bookings...',
  'Dusting off the calendars...',
  'Convincing the rooms to cooperate...',
];
let _loadingMsgInterval = null;

export function showLoadingOverlay(show) {
  let el = document.getElementById('loading-overlay');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';

  clearInterval(_loadingMsgInterval);
  if (show) {
    const msgEl = document.getElementById('loading-overlay-msg');
    let i = Math.floor(Math.random() * LOADING_MESSAGES.length); // random start so fast actions still show variety
    if (msgEl) msgEl.textContent = LOADING_MESSAGES[i];
    _loadingMsgInterval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      if (msgEl) msgEl.textContent = LOADING_MESSAGES[i];
    }, 900);
  }
}

export function toast(msg, isErr, durationMs) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' toast-err' : '');
  t.textContent = msg;
  if (durationMs) {
    const fadeStart = Math.max(0, (durationMs - 300) / 1000);
    t.style.animation = `toastIn 0.2s ease, toastOut 0.3s ease ${fadeStart}s forwards`;
  }
  c.appendChild(t);
  setTimeout(() => t.remove(), durationMs || 3100);
}

// XSS prevention: EVERY place user-controlled text (booker name, purpose,
// etc.) gets inserted into innerHTML must be wrapped in this first. A real
// stored-XSS bug was found and fixed earlier in this project from exactly
// one missed call to this function — treat this as load-bearing security
// code, not a cosmetic helper.
export function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function updateClock() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()];
  const s = now.getSeconds();
  const dayNightIcon = (h >= 6 && h < 18) ? '☀️' : '🌙';
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = dayNightIcon + ' ' + dateStr + '  ' + pad(hr) + ':' + pad(m) + ':' + pad(s) + ' ' + ap;
}

let _confirmModalResolve = null;
export function showConfirmModal(message, confirmLabel, confirmClass) {
  return new Promise(resolve => {
    _confirmModalResolve = resolve;
    document.getElementById('confirm-modal-message').textContent = message;
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.textContent = confirmLabel || 'Confirm';
    btn.className = 'btn ' + (confirmClass || 'btn-approve');
    document.getElementById('confirm-modal').style.display = 'flex';
  });
}

export function resolveConfirmModal(result) {
  document.getElementById('confirm-modal').style.display = 'none';
  if (_confirmModalResolve) { _confirmModalResolve(result); _confirmModalResolve = null; }
}
