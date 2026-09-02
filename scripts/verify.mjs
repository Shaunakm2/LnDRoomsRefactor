#!/usr/bin/env node
// Static verification for LnDRooms. No network, no credentials, no deps.
//
// Every check here exists because the corresponding bug SHIPPED. This is not
// a general-purpose linter — it is a regression net for the specific class of
// failure this project produces: controls that exist, look correct on reading,
// and do nothing.
//
//   node scripts/verify.mjs
//
// Exit 0 = pass. Exit 1 = at least one FAIL.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const ok   = (name, detail = '') => results.push({ status: 'PASS', name, detail });
const fail = (name, detail = '') => results.push({ status: 'FAIL', name, detail });
const warn = (name, detail = '') => results.push({ status: 'WARN', name, detail });

const read = p => readFileSync(join(ROOT, p), 'utf8');
function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}
const jsFiles = walk('js');

// Strip comments and string literals so pattern checks don't match prose or
// the very comments that warn about the pattern.
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

// ---------------------------------------------------------------
// 1. Every inline handler name in index.html is exposed on window.
//    Bug history: onchange="_sortField=..." created an unread global and the
//    sort dropdown was silently dead; !reqSubmitting threw ReferenceError.
// ---------------------------------------------------------------
{
  const html = read('index.html');
  const app  = read('js/app.js');

  const assignBlocks = [...app.matchAll(/Object\.assign\s*\(\s*window\s*,\s*\{/g)];
  if (!assignBlocks.length) {
    fail('window exposure block found', 'no Object.assign(window, {...}) in app.js');
  }
  // Collect identifiers assigned to window, via Object.assign or window.x =
  const exposed = new Set();
  for (const m of assignBlocks) {
    let i = m.index + m[0].length, depth = 1, buf = '';
    while (i < app.length && depth > 0) {
      const c = app[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) break; }
      buf += c; i++;
    }
    for (const k of buf.matchAll(/(^|[,\s])([A-Za-z_$][\w$]*)\s*(?=[,:}\n])/g)) exposed.add(k[2]);
  }
  for (const m of app.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) exposed.add(m[1]);

  // Names referenced by inline handlers
  const GLOBALS = new Set([
    'this','event','window','document','true','false','null','undefined','return',
    'if','else','typeof','new','function','void','const','let','var','in','of',
    'Math','Date','JSON','String','Number','Boolean','Array','Object','console',
    'alert','confirm','parseInt','parseFloat','setTimeout','navigator','location',
  ]);
  const missing = new Map();
  const attrRe = /\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/g;
  let handlers = 0;
  for (const m of html.matchAll(attrRe)) {
    handlers++;
    const code = m[2];
    for (const id of code.matchAll(/(?:^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*(?=\()/g)) {
      const name = id[1];
      if (GLOBALS.has(name) || exposed.has(name)) continue;
      missing.set(name, (missing.get(name) || 0) + 1);
    }
  }
  if (missing.size) {
    fail('inline handlers resolve on window',
      `${handlers} handlers scanned; unresolved: ${[...missing.keys()].join(', ')}`);
  } else {
    ok('inline handlers resolve on window', `${handlers} handlers, ${exposed.size} names exposed`);
  }
}

// ---------------------------------------------------------------
// 2. No bare assignment to a state.js live binding.
//    Bug history: reassigning instead of calling the setter silently desyncs
//    every other module.
// ---------------------------------------------------------------
{
  const stateSrc = read('js/state.js');
  const mutable = [...stateSrc.matchAll(/export\s+let\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  const offenders = [];
  for (const f of jsFiles) {
    if (f.endsWith('state.js')) continue;
    const src = stripNoise(read(f));
    for (const name of mutable) {
      const re = new RegExp(`(?:^|[^.\\w$])${name}\\s*(?:=[^=]|\\+\\+|--|\\+=|-=)`, 'gm');
      if (re.test(src)) offenders.push(`${f}: ${name}`);
    }
  }
  offenders.length
    ? fail('no direct writes to state.js bindings', offenders.join('; '))
    : ok('no direct writes to state.js bindings', `${mutable.length} bindings checked`);
}

// ---------------------------------------------------------------
// 3. supabase.rpc(...) / .from(...) never uses .catch().
//    Bug history: PostgrestBuilder is a lazy thenable with no catch() method.
//    The line threw TypeError AND never sent the request, silently disabling
//    server-side failed-login logging, the attempt counter and its message.
// ---------------------------------------------------------------
{
  const offenders = [];
  for (const f of jsFiles) {
    const src = stripNoise(read(f));
    for (const m of src.matchAll(/\.(?:rpc|from)\s*\([\s\S]{0,400}?\.catch\s*\(/g)) {
      offenders.push(`${f}: ${src.slice(m.index, m.index + 60).replace(/\s+/g, ' ')}`);
    }
  }
  offenders.length
    ? fail('no .catch() on PostgrestBuilder', offenders.join('; '))
    : ok('no .catch() on PostgrestBuilder');
}

// ---------------------------------------------------------------
// 4. schema.sql invariants.
// ---------------------------------------------------------------
{
  const sqlRaw = read('supabase/schema.sql');
  // Strip SQL comments first: this file documents the rules it follows, so an
  // unstripped scan matches the comment that says "no DROP TABLE anywhere".
  const sql = sqlRaw.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  /(drop\s+table)/i.test(sql)
    ? fail('schema has no DROP TABLE')
    : ok('schema has no DROP TABLE');

  // Every SECURITY DEFINER function must name pg_temp in its search_path.
  const defs = [...sql.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?(?=\$\$)/gi)];
  const badPath = [];
  for (const d of defs) {
    const head = d[0];
    if (!/security\s+definer/i.test(head)) continue;
    if (!/search_path\s*=\s*[^;\n]*pg_temp/i.test(head)) badPath.push(d[1]);
  }
  badPath.length
    ? fail('definer functions name pg_temp', badPath.join(', '))
    : ok('definer functions name pg_temp', `${defs.length} functions scanned`);

  // No admin policy may be unconditional.
  const loose = [];
  for (const p of sql.matchAll(/create\s+policy\s+"([^"]+)"[\s\S]*?;/gi)) {
    const body = p[0];
    if (!/admin/i.test(p[1])) continue;
    if (/using\s*\(\s*true\s*\)/i.test(body) || /with\s+check\s*\(\s*true\s*\)/i.test(body)) loose.push(p[1]);
  }
  loose.length
    ? fail('no unconditional admin policy', loose.join(', '))
    : ok('no unconditional admin policy');

  // IPv6 grouping needs network(), not set_masklen() alone.
  if (/set_masklen/i.test(sql) && !/network\s*\(\s*set_masklen/i.test(sql)) {
    fail('IPv6 masking uses network(set_masklen(...))',
         'set_masklen alone leaves host bits intact and groups nothing');
  } else {
    ok('IPv6 masking uses network(set_masklen(...))');
  }

  // The limiter must not key on inet_client_addr() directly: under PostgREST
  // that is loopback for every user.
  const logFn = sql.match(/create\s+or\s+replace\s+function\s+public\.log_failed_login[\s\S]*?\$\$[\s\S]*?\$\$/i);
  if (logFn && /values\s*\(\s*inet_client_addr\(\)\s*\)/i.test(logFn[0])) {
    fail('log_failed_login uses client_ip()', 'still inserting inet_client_addr()');
  } else {
    ok('log_failed_login uses client_ip()');
  }

  // config.js ADMIN_EMAIL must match is_admin() in the schema.
  const cfg = read('js/config.js').match(/ADMIN_EMAIL\s*=\s*['"]([^'"]+)['"]/i);
  const schemaEmail = sql.match(/auth\.jwt\(\)\s*->>\s*'email'\)\s*=\s*'([^']+)'/i);
  if (!cfg || !schemaEmail) {
    warn('ADMIN_EMAIL matches is_admin()', 'could not locate one of the two values');
  } else if (cfg[1].trim().toLowerCase() !== schemaEmail[1].trim().toLowerCase()) {
    fail('ADMIN_EMAIL matches is_admin()', `config.js=${cfg[1]} schema=${schemaEmail[1]}`);
  } else {
    ok('ADMIN_EMAIL matches is_admin()', cfg[1]);
  }
}

// ---------------------------------------------------------------
// 4b. Regression guards for the three findings fixed in this pass.
// ---------------------------------------------------------------
{
  const sql = read('supabase/schema.sql');
  const client = read('js/api/supabase-client.js');
  const auth = read('js/api/auth.js');

  // CRITICAL: booking_id must be format-constrained in the DB and validated
  // in the client. It is interpolated into onclick attributes unescaped.
  /booking_id_format/.test(sql)
    ? ok('booking_id CHECK constraint in schema')
    : fail('booking_id CHECK constraint in schema', 'stored XSS vector is open');

  /ID_OK|\^\[A-Za-z0-9_-\]\{1,40\}\$/.test(client)
    ? ok('booking_id validated in loadData')
    : fail('booking_id validated in loadData', 'unsafe ids reach the DOM');

  // HIGH: the insert rate limiter must count transactions, not rows, or a
  // batched recurring booking trips its own limit and rolls back.
  /count\(distinct txid\)/i.test(sql)
    ? ok('insert limiter counts transactions')
    : fail('insert limiter counts transactions', 'recurring bookings will fail');

  // HIGH: the lockout must actually be read, not just written.
  /Date\.now\(\)\s*<\s*loginLockedUntil/.test(auth)
    ? ok('login lockout is enforced')
    : fail('login lockout is enforced', 'loginLockedUntil is set but never read');
}

// ---------------------------------------------------------------
// 4c. Utility classes applied to form controls must be element-qualified.
//     `.form-group input` is (0,1,1) and sets width:100% plus
//     appearance:none. A bare `.cb-lg` (0,1,0) loses to it, and the recurring
//     checkbox rendered as a full-width empty box with its label pushed off
//     screen. These properties used to live in inline style attributes, which
//     always beat class selectors — the specificity was doing real work and
//     was lost silently in the conversion.
// ---------------------------------------------------------------
{
  const css = read('style.css');
  const bad = [];
  for (const cls of ['cb-lg', 'cb-danger', 'cb-label']) {
    // Every selector mentioning the class must name an element or an
    // attribute, i.e. never appear as a lone `.cls {`.
    const lone = new RegExp(`(^|[,\\s])\\.${cls}\\s*[,{]`, 'm');
    if (lone.test(css)) bad.push(cls);
  }
  bad.length
    ? fail('form-control classes are element-qualified',
           `${bad.join(', ')} will lose to .form-group input/label`)
    : ok('form-control classes are element-qualified');
}

// ---------------------------------------------------------------
// 5. Service worker cache version bumped when shipped assets change.
//    Bug history: stale modules served after deploy, making observed
//    behaviour contradict the source being read.
// ---------------------------------------------------------------
{
  const sw = read('sw.js');
  const m = sw.match(/['"]([\w-]*shell-v(\d+))['"]/);
  m ? ok('service worker cache versioned', m[1])
    : warn('service worker cache versioned', 'no ...-vN cache name found in sw.js');
}

// ---------------------------------------------------------------
// 6. No secret key committed.
// ---------------------------------------------------------------
{
  const hits = [];
  for (const f of [...jsFiles, 'index.html', 'sw.js']) {
    if (/sb_secret_/.test(read(f))) hits.push(f);
  }
  hits.length
    ? fail('no sb_secret_ key in source', hits.join(', '))
    : ok('no sb_secret_ key in source');
}

// ---------------------------------------------------------------
// 7. Module graph links. Catches typo'd import paths and missing exports,
//    which no amount of reading reliably catches.
// ---------------------------------------------------------------
{
  const problems = [];
  const exportsOf = new Map();
  for (const f of jsFiles) {
    const src = read(f);
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g))
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop().trim();
        if (n) names.add(n);
      }
    if (/export\s+default/.test(src)) names.add('default');
    exportsOf.set(f, names);
  }
  for (const f of jsFiles) {
    const src = read(f);
    for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[2];
      if (!spec.startsWith('.')) continue;
      const target = relative(ROOT, resolve(dirname(join(ROOT, f)), spec));
      if (!exportsOf.has(target)) { problems.push(`${f} -> ${spec} (file not found)`); continue; }
      const clause = m[1];
      const named = clause.match(/\{([^}]*)\}/);
      if (!named) continue;
      for (const part of named[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0].trim();
        if (n && !exportsOf.get(target).has(n)) problems.push(`${f}: '${n}' not exported by ${target}`);
      }
    }
  }
  problems.length
    ? fail('module graph links', problems.join('; '))
    : ok('module graph links', `${jsFiles.length} modules`);
}

// ---------------------------------------------------------------
// Report
// ---------------------------------------------------------------
const pad = Math.max(...results.map(r => r.name.length));
let failed = 0;
for (const r of results) {
  if (r.status === 'FAIL') failed++;
  const tag = r.status === 'PASS' ? '  ok  ' : r.status === 'WARN' ? ' warn ' : ' FAIL ';
  console.log(`[${tag}] ${r.name.padEnd(pad)}  ${r.detail}`);
}
const warns = results.filter(r => r.status === 'WARN').length;
console.log(`\n${results.length - failed - warns} passed, ${warns} warned, ${failed} failed`);
process.exit(failed ? 1 : 0);
