// js/api/notifications.js
// Fire-and-forget Teams notifications. Deliberately never awaited by
// callers and wrapped in its own catch — a Teams outage must never be
// able to break an actual booking action.

import { TEAMS_NOTIFY_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';

export function notifyTeams(payload) {
  fetch(TEAMS_NOTIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // IMPORTANT: apikey header ONLY. Supabase's new-style publishable
      // keys (sb_publishable_...) are NOT JWTs — putting one in
      // `Authorization: Bearer` causes a silent 401 at the platform
      // gateway, before the Edge Function's own code ever runs (so it
      // won't even show up in the function's own logs). This was a real
      // bug found and fixed earlier in this project — do not reintroduce
      // an Authorization header here.
      'apikey': SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload),
  }).then(res => {
    if (!res.ok) res.text().then(t => console.error('notifyTeams non-OK response:', res.status, t));
  }).catch(err => console.error('notifyTeams failed:', err));
}
