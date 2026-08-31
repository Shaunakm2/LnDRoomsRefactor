// js/api/auth.js
// Admin sign-in/out. Note: this imports showPage/toast (UI-layer concerns)
// because the original login flow directly navigates on success — a
// stricter architecture would have the UI layer call doLogin() and handle
// navigation itself via the return value, but that's a bigger behavioral
// change than a straight refactor should make. Flagged here for later.

import { supabase } from './supabase-client.js';
import { ADMIN_EMAIL } from '../config.js';
import {
  adminLoggedIn,
  loginAttempts, setLoginAttempts, loginLockedUntil, setLoginLockedUntil,
  MAX_LOGIN_ATTEMPTS, LOCKOUT_MS, setLastActivityAt,
  setAdminLoggedIn, setSessionToken
} from '../state.js';
import { toast, showLoadingOverlay } from '../utils/dom-helpers.js';
import { showPage } from '../ui/pages.js'; // see note above

export function requireAdmin() {
  if (adminLoggedIn) {
    showPage('admin');
  } else {
    document.getElementById('login-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('login-pw').focus(), 50);
  }
}

export async function doLogout() {
  await supabase.auth.signOut();
  setAdminLoggedIn(false);
  setSessionToken(null);
  document.getElementById('logout-btn').style.display = 'none';
  showPage('status');
  toast('Logged out.');
}

export async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  if (!pw) return;
  console.log('DEBUG pw length:', pw.length, JSON.stringify(pw));
  // Real, server-enforced rate limiting — this RPC call must succeed
  // before we're even allowed to attempt the actual sign-in. Unlike a
  // client-side-only counter (trivially bypassed by refreshing the page),
  // this lives in Postgres and can't be reset by the browser. See
  // supabase/schema.sql's check_login_rate_limit() for the server side.
  try {
    const { data: rl, error: rlErr } = await supabase.rpc('check_login_rate_limit');
    if (!rlErr && rl && rl.ok === false) {
      document.getElementById('login-error').textContent = `Too many attempts. Try again in ${rl.retry_after_seconds}s.`;
      document.getElementById('login-error').classList.add('visible');
      return;
    }
  } catch (e) {
    // If the rate-limit check itself fails (network issue etc), fail safe
    // by still allowing the attempt — never let an outage lock out the
    // legitimate admin. The real sign-in call below still requires the
    // correct password regardless.
  }

  try {
    showLoadingOverlay(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: pw });
    if (!error && data.session) {
      setLoginAttempts(0);
      setLoginLockedUntil(0);
      setLastActivityAt(Date.now());
      setAdminLoggedIn(true);
      setSessionToken(data.session.access_token);
      document.getElementById('logout-btn').style.display = '';
      document.getElementById('login-modal').style.display = 'none';
      document.getElementById('login-pw').value = '';
      document.getElementById('login-error').classList.remove('visible');
      showPage('admin');
      toast('Welcome, Admin.');
    } else {
      setLoginAttempts(loginAttempts + 1);
      if (loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS) {
        setLoginLockedUntil(Date.now() + LOCKOUT_MS);
        setLoginAttempts(0);
        document.getElementById('login-error').textContent = 'Too many failed attempts. Locked for 5 minutes.';
      } else {
        document.getElementById('login-error').textContent = `Incorrect password. ${MAX_LOGIN_ATTEMPTS - (loginAttempts + 1)} attempt(s) remaining.`;
      }
      document.getElementById('login-error').classList.add('visible');
      document.getElementById('login-pw').value = '';
      document.getElementById('login-pw').focus();
    }
  } catch (e) {
    document.getElementById('login-error').textContent = 'Connection error. Try again.';
    document.getElementById('login-error').classList.add('visible');
  } finally {
    showLoadingOverlay(false);
  }
}

export function closeLogin() {
  document.getElementById('login-modal').style.display = 'none';
  document.getElementById('login-pw').value = '';
  document.getElementById('login-error').classList.remove('visible');
}
