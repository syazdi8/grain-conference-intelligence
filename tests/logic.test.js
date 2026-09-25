// Tests for the deterministic core, run with `npm test` (Node 18+). They use the real CSV and seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConferences, icpScore, tierOf } from '../js/scoring.js';
import { computeState, nudgeFor, openSteps } from '../js/relationship.js';
import { findMatches, sameCompany } from '../js/matching.js';
import { unownedATier, clusters, currentConference, inWindow, captureOptions } from '../js/planning.js';
import { buildHubspotCsv, exportWarnings, exportableEmail } from '../js/exporter.js';
import { parseCSV } from '../js/csv.js';
import { validateRead } from '../js/ai.js';
import { today, freshWorkspace, loadWorkspace } from '../js/store.js';

const csv = readFileSync(new URL('../data/conferences.csv', import.meta.url), 'utf8');
const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const TODAY = seed.demoDate;
const encOf = (id) => seed.encounters.filter((e) => e.contactId === id);
const contact = (id) => seed.contacts.find((c) => c.id === id);

test('conference CSV loads all 13 rows with the approved tiers', () => {
  const { conferences, warnings } = loadConferences(csv);
  assert.deepEqual(warnings, []);
  assert.equal(conferences.length, 13);
  const tiers = Object.fromEntries(conferences.map((c) => [c.id, `${c.tier} ${c.score.toFixed(1)}`]));
  assert.deepEqual(tiers, {
    eurofinance: 'A 96.7', mpe: 'A 91.7', phocuswright: 'A 78.3', 'money2020-usa': 'A 75.0', 'money2020-europe': 'A 75.0',
    'iata-wfs': 'B 66.7', afp: 'B 65.0', 'itb-berlin': 'B 63.3', sibos: 'B 60.0', 'fintech-meetup': 'B 55.0',
    'marketplace-risk': 'C 45.0', 'ifx-expo-dubai': 'C 41.7', saastr: 'C 25.0',
  });
});

test('raw score is classified without rounding, and all 256 rating combinations tier correctly', () => {
  for (let s = 0; s < 4; s++) for (let p = 0; p < 4; p++) for (let f = 0; f < 4; f++) for (let c = 0; c < 4; c++) {
    const n = 35 * s + 30 * p + 25 * f + 10 * c;
    const expected = n >= 225 ? 'A' : n >= 165 ? 'B' : 'C';
    assert.equal(tierOf(icpScore({ segment: s, persona: p, fx: f, concentration: c })), expected, `${s}${p}${f}${c}`);
  }
});

test('a bad CSV row becomes a warning, not a crash', () => {
  const bad = csv.replace(',3,"Built around', ',4,"Built around');
  assert.notEqual(bad, csv);
  const { conferences, warnings } = loadConferences(bad);
  assert.equal(conferences.length, 12);
  assert.match(warnings[0], /Merchant Payments Ecosystem.*not 0–3.*skipped/);
});

test('public conference data carries no internal working notes', () => {
  // Evidence lines are shown in the app ("Why this tier"); every text field ships in the public repo.
  const internal = /\b[DC]\d{1,2}\b|\bShay\b|\bClaude\b|fetch tool/;
  for (const row of parseCSV(csv).slice(1)) {
    for (const cell of row) assert.doesNotMatch(cell, internal, `${row[0]}: ${cell}`);
  }
});

test('every seeded contact lands in its designed state at the demo date', () => {
  const expected = { dana: 'Warming', oliver: 'Warming', tom: 'Low intent', marco: 'Low intent', priya: 'Stalled', sven: 'Stalled',
    emma: 'Early', chris: 'Early', hannah: 'Early', ryan: 'Early', nadia: 'Early', alex: 'Early', david: 'Early', grace: 'Early', johanna: 'Early' };
  for (const [id, state] of Object.entries(expected)) assert.equal(computeState(encOf(id), TODAY).state, state, id);
});

test('Warming decays after 6 quiet months (C7)', () => {
  assert.equal(computeState(encOf('oliver'), '2027-01-15').state, 'Stalled');
});

test('Dana stays Warming after the scripted demo capture', () => {
  const live = { id: 'live', date: TODAY, outcome: 'Next step agreed', nextStep: { text: 'CFO call next week', status: 'Open' } };
  assert.equal(computeState([...encOf('dana'), live], TODAY).state, 'Warming');
});

test('overdue rule (C8): Chris has a due date and is not overdue; Johanna has none and is', () => {
  assert.equal(openSteps(encOf('chris'), TODAY)[0].overdue, false);
  assert.equal(openSteps(encOf('chris'), '2026-10-28')[0].overdue, true);
  assert.equal(openSteps(encOf('johanna'), TODAY)[0].overdue, true);
  assert.equal(nudgeFor(contact('johanna'), encOf('johanna'), TODAY).label, 'Overdue');
  assert.equal(nudgeFor(contact('chris'), encOf('chris'), TODAY).label, 'Next step');
  assert.equal(nudgeFor(contact('tom'), encOf('tom'), TODAY).level, 'soft');
  assert.equal(nudgeFor(contact('ryan'), encOf('ryan'), TODAY), null);
});

test('an override changes the label and nudge, and the rules still compute the original', () => {
  const marco = { ...contact('marco'), override: { state: 'Warming', reason: 'Budget approved for Q1; RFP due in November' } };
  assert.equal(computeState(encOf('marco'), TODAY).state, 'Low intent');
  assert.equal(nudgeFor(marco, encOf('marco'), TODAY).label, 'Act now');
});

test('matching levels for the demo and QA fixtures', () => {
  const lvl = (input) => findMatches(input, seed.contacts).map((m) => `${m.contact.id}:${m.level}`);
  assert.deepEqual(lvl({ name: 'Dana Levi', company: '' }), ['dana:nameOnly']);
  assert.deepEqual(lvl({ name: 'Dana Levi', company: 'Tarvio Payments' }), ['dana:jobChange']);
  assert.deepEqual(lvl({ name: 'dana levi', company: 'Quellan Payments Ltd' }), ['dana:strong']);
  assert.deepEqual(lvl({ name: 'Alex Novak', company: 'Kvetta Pay' }), ['alex:variation']);
  assert.deepEqual(lvl({ name: 'A. Novak', company: 'Kvetta Pay' }), ['alex:variation']);
  assert.deepEqual(lvl({ name: 'Novak Alexander', company: 'Kvetta Pay' }), ['alex:strong']);
  assert.deepEqual(lvl({ name: 'Tom Beker', company: 'Arvelo Pay' }), ['tom:variation']);
  assert.deepEqual(lvl({ name: 'Someone', company: '', email: 'TOM.BECKER@arvelopay.example' }), ['tom:certain']);
  assert.deepEqual(lvl({ name: 'David Katz', company: 'First Harbor Bank' }), ['david:jobChange']);
  assert.deepEqual(lvl({ name: 'Luis Ortega', company: 'Crateline', email: 'payments@crateline.example' }), []); // shared inbox
  assert.deepEqual(lvl({ name: 'Émma Walsh', company: 'Ledgerline' }), ['emma:strong']); // accents
  assert.deepEqual(lvl({ name: 'Maria Rossi', company: 'Crateline' }), []); // similar name, not a variant
  assert.ok(sameCompany('Quellan', 'Quellan Payments'));
  assert.ok(!sameCompany('Pay', 'Paysafe'));
});

test('planning flags: Phocuswright unowned A; MPE + ITB Berlin cluster; Money20/20 USA is today', () => {
  const { conferences } = loadConferences(csv);
  assert.deepEqual(unownedATier(conferences, seed.owners, TODAY).map((c) => c.id), ['phocuswright']);
  assert.deepEqual(clusters(conferences, TODAY).map((x) => [x.a.id, x.b.id, x.gapDays]), [['mpe', 'itb-berlin', 5]]);
  assert.equal(currentConference(conferences, seed.owners, 'jordan', TODAY).id, 'money2020-usa');
  assert.equal(conferences.filter((c) => inWindow(c, TODAY)).length, 13);
});

test('HubSpot CSV: quoting survives commas and quotes; shared inbox and missing email are handled', () => {
  const rows = [{ contact: { name: 'Tom Becker', company: 'Arvelo Pay', title: 'Head of Product', email: 'tom.becker@arvelopay.example' },
    latestConference: 'Money20/20 Europe 2026', latestDate: '2026-06-04', conferencesMetAt: 'A; B', state: 'Low intent',
    stateBasis: 'Rules', action: 'Keep light, "no push", monthly', summary: 'Line one,\nline two', rep: 'Sofia Marín' }];
  const parsed = parseCSV(buildHubspotCsv(rows));
  assert.equal(parsed[1][10], 'Keep light, "no push", monthly');
  assert.equal(parsed[1][11], 'Line one,\nline two');
  assert.equal(exportableEmail(contact('nadia')), '');
  assert.match(exportWarnings(contact('nadia'))[0], /shared inbox/);
  const moved = { name: 'Dana Levi', email: null, history: [{ company: 'Quellan Payments', email: 'dana.levi@quellanpay.example' }] };
  assert.match(exportWarnings(moved)[0], /no current email \(last known at Quellan Payments/);
});

test('AI read guard drops evidence that cites encounters the contact does not have', () => {
  const r = validateRead({ summary: 'ok', evidence: [{ encounterId: 'e01', point: 'a' }, { encounterId: 'e99', point: 'b' }], suggestedAction: 'x' }, ['e01', 'e02']);
  assert.equal(r.evidence.length, 1);
  assert.equal(r.droppedEvidence, 1);
  assert.equal(validateRead({ summary: '' }, []), null);
});

// Swaps in an in-memory localStorage for one test, then restores whatever the runtime had.
function withStorage(items, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = { ...items };
  const mock = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
  try { return fn(mem); } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
}

test('the app always runs on the fixed demo date, and a saved real-date flag is dropped on load', () => {
  assert.equal(today(seed), '2026-10-19');
  assert.equal('useRealDate' in freshWorkspace(seed), false);
  const stuck = { ...freshWorkspace(seed), useRealDate: true }; // a browser left in real-date mode by the retired toggle
  withStorage({ 'grain-conference-intel:workspace': JSON.stringify(stuck) }, () => {
    const { ws, notice } = loadWorkspace(seed);
    assert.equal(notice, null);
    assert.equal('useRealDate' in ws, false);
  });
});

test('static check: no real-date toggle and no 12-month filter left in the UI', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<button[^>]*id="date-chip"/);
  assert.doesNotMatch(app, /useRealDate|use real date|data-filter="window"|Next 12 months/);
  assert.match(app, /Demo date · /);
});

test('capture only offers conferences happening on the app date, never one that has not started', () => {
  const { conferences } = loadConferences(csv);
  assert.deepEqual(captureOptions(conferences, TODAY).map((c) => c.id), ['money2020-usa']);
  assert.deepEqual(captureOptions(conferences, '2026-10-17'), []); // day before Money20/20 USA opens
  assert.deepEqual(captureOptions(conferences, '2026-10-22'), []); // day after it ends: no late logging in the prototype
  assert.deepEqual(captureOptions(conferences, '2027-05-11').map((c) => c.id), ['marketplace-risk', 'saastr']); // two at once: the rep picks
  for (const c of conferences.filter((x) => x.start > TODAY)) assert.ok(!captureOptions(conferences, TODAY).includes(c), c.id);
});
