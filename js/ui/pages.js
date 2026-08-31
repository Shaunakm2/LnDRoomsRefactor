// js/ui/pages.js
// Switches between the "Room Status" and "Admin" pages, triggering the
// right renders for whichever page becomes active.

import { renderStatusGrid } from './status-grid.js';
import { renderTable, renderActiveNow, resetForm } from './admin-table.js';
import { renderPendingRequests } from './pending-list.js';

export function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (name === 'status') {
    document.querySelectorAll('.nav-tab')[0].classList.add('active');
    renderStatusGrid();
  } else if (name === 'admin') {
    document.querySelectorAll('.nav-tab')[1].classList.add('active');
    renderTable();
    renderActiveNow();
    renderPendingRequests();
    resetForm();
  }
}
