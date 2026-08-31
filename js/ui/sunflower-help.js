// js/ui/sunflower-help.js
// The clickable sunflower easter egg + its FAQ panel. Fully self-contained
// — no dependency on `bookings` or any other module's state.

const SUNFLOWER_FAQ = [
  { q: 'How do I book a room?',
    a: 'Click any room on the Room Status page and use "Request a Booking." It goes in as Pending until an admin approves it.' },
  { q: 'Why does my booking still say Pending?',
    a: "New requests need admin approval before they're confirmed. Check back, or reach out to the admin if it's been a while." },
  { q: 'Can I cancel my own booking?',
    a: 'Yes — open the room\'s schedule and click Cancel on your booking, then type your name exactly as you booked it to confirm.' },
  { q: 'What happens if two bookings conflict?',
    a: "You'll see a conflict notice when submitting. The request still goes in as Pending — an admin will resolve which one is confirmed." },
  { q: 'How far ahead can I see a room\'s schedule?',
    a: 'Click a room to open its schedule — it shows 30 days back and 30 days ahead, centered on today.' },
  { q: 'I need something this isn\'t covering.',
    a: 'Reach out to your admin directly — this panel only covers common questions, not live support.' },
];

export function renderSunflowerHelp() {
  const body = document.getElementById('sf-help-body');
  if (!body) return;
  body.innerHTML = SUNFLOWER_FAQ.map((item, i) => `
    <div class="sf-faq-item" id="sf-faq-${i}">
      <button class="sf-faq-q" onclick="toggleSunflowerFaq(${i})">
        <span>${item.q}</span>
        <span class="sf-faq-caret">&#9656;</span>
      </button>
      <div class="sf-faq-a">${item.a}</div>
    </div>
  `).join('');
}

export function toggleSunflowerFaq(i) {
  document.getElementById('sf-faq-' + i)?.classList.toggle('open');
}

export function toggleSunflowerHelp(force) {
  const panel = document.getElementById('sunflower-help-panel');
  if (!panel) return;
  const show = force !== undefined ? force : panel.style.display === 'none';
  if (show) {
    if (!panel.dataset.rendered) { renderSunflowerHelp(); panel.dataset.rendered = '1'; }
    panel.style.display = 'flex';
  } else {
    panel.style.display = 'none';
  }
}

// These two listeners were originally bare top-level code in app.js — kept
// here since they're purely about this panel's own dismiss behavior, but
// wrapped in an init function so app.js controls exactly when they attach
// rather than them firing the instant this module is imported.
export function initSunflowerListeners() {
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('sunflower-help-panel');
    const plant = document.getElementById('sunflower-plant');
    if (!panel || panel.style.display === 'none') return;
    if (!panel.contains(e.target) && e.target !== plant) {
      toggleSunflowerHelp(false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleSunflowerHelp(false);
  });
}
