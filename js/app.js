// UI: one render function per screen, built from the deterministic core modules. Hash routes (#/plan …).
import { esc, fmtDate, fmtDay, fmtRange, monthLabel, addMonths, uid, todayReal } from './util.js';
import { DIMENSIONS, TIERS, displayScore } from './scoring.js';
import { planningWindow, inWindow, unownedATier, clusters, currentConference, isHappening } from './planning.js';
import { findMatches, LEVELS, sameCompany } from './matching.js';
import { computeState, effectiveState, nudgeFor, byDate, OUTCOMES, STATES, STEP_STATUSES } from './relationship.js';
import { buildHubspotCsv, exportWarnings } from './exporter.js';
import { signature, buildPayload, validateRead, requestRead } from './ai.js';
import * as store from './store.js';

const S = {
  conferences: [], warnings: [], seed: null, ws: null, notice: null,
  filters: { q: '', tier: 'all', vertical: 'all', region: 'all', window: true, sort: 'tier' },
  contactFilter: 'all', contactQuery: '', selected: new Set(), exportCheck: null,
  draft: null, lastSaved: null, overrideFor: null, aiPending: {}, aiErrors: {},
};
const view = document.getElementById('view');

// ---------- helpers ----------
const today = () => store.today(S.ws, S.seed);
const confById = (id) => S.conferences.find((c) => c.id === id);
const confName = (e) => `${confById(e.conferenceId)?.name || e.conferenceId} ${e.edition}`;
const rep = (id) => S.seed.reps.find((r) => r.id === id);
const repName = (id) => rep(id)?.name || id || 'Unknown';
const contactById = (id) => S.ws.contacts.find((c) => c.id === id);
const encountersOf = (id) => S.ws.encounters.filter((e) => e.contactId === id);
const save = () => { if (!store.saveWorkspace(S.ws)) S.notice = 'storage'; };

function contactView(c) {
  const encs = byDate(encountersOf(c.id));
  const rule = computeState(encs, today());
  return { c, encs, rule, eff: effectiveState(c, rule), nudge: nudgeFor(c, encs, today()), last: encs[encs.length - 1] };
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

const tierBadge = (t, big = false) => `<span class="tier tier-${t}${big ? ' big' : ''}" title="${esc(TIERS[t])}">${t}</span>`;
const stateBadge = (s, override = false) => `<span class="state state-${s.replace(' ', '-').toLowerCase()}">${esc(s)}${override ? ' <small>override</small>' : ''}</span>`;
const nudgeHtml = (n) => (n ? `<div class="nudge nudge-${n.level}"><strong>${esc(n.label)}:</strong> ${esc(n.text)}</div>` : '');
const dots = (v) => '●'.repeat(v) + '○'.repeat(3 - v);
const ownerSelect = (confId, cls = '') => `<select class="owner ${cls}" data-action="assign" data-conf="${confId}" aria-label="Owner">
  <option value="">No owner</option>${S.seed.reps.map((r) => `<option value="${r.id}" ${S.ws.owners[confId] === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;

function exportStatus(c) {
  if (!c.export) return 'Not exported';
  const changed = encountersOf(c.id).length !== c.export.encounterCount || (c.export.company && c.export.company !== c.company);
  return changed ? `Changed since export (exported ${fmtDate(c.export.date)})` : `Exported ${fmtDate(c.export.date)}`;
}

function freshDraft(conferenceId = null) {
  return { conferenceId, name: '', company: '', title: '', email: '', outcome: '', nextStep: '', due: '', note: '', link: null, rejected: [] };
}

// ---------- routing & chrome ----------
function route() {
  const [page = 'conferences', id] = location.hash.replace(/^#\/?/, '').split('/');
  return { page, id: id && decodeURIComponent(id) };
}

function renderChrome() {
  const { page } = route();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === page || (a.dataset.route === 'conferences' && page === 'conference') || (a.dataset.route === 'contacts' && page === 'contact')));
  document.getElementById('user').innerHTML = S.seed.reps.map((r) => `<option value="${r.id}" ${r.id === S.ws.currentUser ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  document.getElementById('date-chip').innerHTML = S.ws.useRealDate
    ? `Real date · ${esc(fmtDay(today()))} <u>use demo date</u>`
    : `Demo date · ${esc(fmtDay(today()))} ${esc(today().slice(0, 4))} <u>use real date</u>`;
  const b = [];
  if (S.notice === 'storage') b.push('This browser is blocking local storage, so your changes will be lost on reload.');
  if (S.notice === 'seed-changed') b.push('The demo data has been updated since your last visit. <button class="link-btn" data-action="reset">Reset to load it</button>');
  if (S.warnings.length) b.push(`${S.warnings.length} row(s) in conferences.csv were skipped. See the Conferences page.`);
  document.getElementById('banner').innerHTML = b.map((x) => `<div class="banner">${x}</div>`).join('');
}

function render() {
  renderChrome();
  const { page, id } = route();
  const pages = { conferences: renderConferences, conference: renderConference, plan: renderPlan, capture: renderCapture, contacts: renderContacts, contact: renderProfile };
  view.innerHTML = (pages[page] || renderConferences)(id);
  if (page === 'capture') updateMatches();
  if (page === 'contact') maybeFetchRead(id);
}

// ---------- Conferences ----------
function renderConferences() {
  const f = S.filters;
  const t = today();
  const verticals = [...new Set(S.conferences.map((c) => c.vertical))].sort();
  const regions = [...new Set(S.conferences.map((c) => c.region))].sort();
  const q = f.q.trim().toLowerCase();
  let list = S.conferences.filter((c) => (!f.window || !c.start || inWindow(c, t))
    && (f.tier === 'all' || c.tier === f.tier) && (f.vertical === 'all' || c.vertical === f.vertical)
    && (f.region === 'all' || c.region === f.region)
    && (!q || `${c.name} ${c.city} ${c.country} ${c.vertical}`.toLowerCase().includes(q)));
  list = list.sort(f.sort === 'date' ? (a, b) => (a.start || '9').localeCompare(b.start || '9') : (a, b) => a.tier.localeCompare(b.tier) || b.score - a.score);
  const count = (tier) => list.filter((c) => c.tier === tier).length;
  const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  return `
  <section class="pad">
    <h1>Conferences</h1>
    <p class="lede">Ranked by <strong>ICP fit</strong>: how well the room matches Grain's customers. A tier says how good the room is, not whether to go. Audience size is shown but never scored.</p>
    ${S.warnings.length ? `<div class="warn"><strong>Skipped rows in conferences.csv:</strong><ul>${S.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="filters">
      <input type="search" placeholder="Search name, city, vertical" value="${esc(f.q)}" data-filter="q" aria-label="Search">
      <div class="seg" role="group" aria-label="Tier">${['all', 'A', 'B', 'C'].map((x) => `<button type="button" data-action="tier" data-v="${x}" class="${f.tier === x ? 'on' : ''}">${x === 'all' ? 'All tiers' : `Tier ${x}`}</button>`).join('')}</div>
      <select data-filter="vertical" aria-label="Vertical">${opt('all', f.vertical, 'All verticals')}${verticals.map((v) => opt(v, f.vertical)).join('')}</select>
      <select data-filter="region" aria-label="Region">${opt('all', f.region, 'All regions')}${regions.map((v) => opt(v, f.region)).join('')}</select>
      <select data-filter="sort" aria-label="Sort">${opt('tier', f.sort, 'Sort: tier, then score')}${opt('date', f.sort, 'Sort: date')}</select>
      <label class="check"><input type="checkbox" data-filter="window" ${f.window ? 'checked' : ''}> Next 12 months</label>
    </div>
    <p class="muted small">${list.length} events · A ${count('A')} · B ${count('B')} · C ${count('C')}</p>
    <div class="cards">
      ${list.map((c) => `
      <a class="card conf-card" href="#/conference/${c.id}">
        ${tierBadge(c.tier, true)}
        <div class="conf-main">
          <div class="conf-name">${esc(c.name)} ${esc(c.edition)}</div>
          <div class="muted">${c.start ? esc(fmtRange(c.start, c.end)) : esc(c.typicalTiming || 'Dates TBC')} · ${esc(c.city)}, ${esc(c.country)}</div>
          <div class="small">${esc(c.vertical)} · ${esc(c.audience)}</div>
        </div>
        <div class="conf-side small">
          <div>ICP ${displayScore(c.score)}</div>
          <div class="${S.ws.owners[c.id] ? '' : 'muted'}">${S.ws.owners[c.id] ? esc(repName(S.ws.owners[c.id])) : 'No owner'}</div>
          ${isHappening(c, t) ? '<div class="live">Happening now</div>' : ''}
        </div>
      </a>`).join('') || '<p class="muted">No events match these filters.</p>'}
    </div>
    <p class="muted small">Tier A ≥ 75: ${esc(TIERS.A)} · B 55–74: ${esc(TIERS.B)} · C &lt; 55: ${esc(TIERS.C)}.</p>
  </section>`;
}

function renderConference(id) {
  const c = confById(id);
  if (!c) return '<section class="pad"><p>Conference not found. <a href="#/conferences">Back</a></p></section>';
  const t = today();
  const cl = clusters(S.conferences, t).filter((x) => x.a.id === id || x.b.id === id);
  const flags = [];
  if (c.tier === 'A' && inWindow(c, t) && !S.ws.owners[c.id]) flags.push('<div class="flag flag-a">High ICP fit, no owner yet. Decide whether to cover it.</div>');
  for (const x of cl) { const o = x.a.id === id ? x.b : x.a; flags.push(`<div class="flag">Combine the trip? <a href="#/conference/${o.id}">${esc(o.name)} ${esc(o.edition)}</a> is in ${esc(x.city)} ${x.gapDays} days apart (${esc(fmtRange(o.start, o.end))}).</div>`); }
  return `
  <section class="pad narrow">
    <a href="#/conferences" class="back">← Conferences</a>
    <h1>${esc(c.name)} ${esc(c.edition)}</h1>
    <p class="muted">${c.start ? esc(fmtRange(c.start, c.end)) : esc(c.typicalTiming || 'Dates TBC')} (${esc(c.dateStatus)}) · ${esc(c.venue ? `${c.venue}, ` : '')}${esc(c.city)}, ${esc(c.country)} · ${esc(c.vertical)}</p>
    <p class="small">Audience: ${esc(c.audience)} <span class="muted">(${esc(c.audienceBasis)}; shown, never scored)</span></p>
    <div class="panel tier-panel">
      ${tierBadge(c.tier, true)}
      <div><div class="tier-meaning">${esc(TIERS[c.tier])}</div>
      <div class="muted small">ICP score ${displayScore(c.score)} / 100 · A tier describes the room; the sales lead decides whether to go.</div></div>
    </div>
    ${flags.join('')}
    <h2>Why this tier</h2>
    <table class="breakdown">
      <thead><tr><th>Dimension</th><th>Rating</th><th>Points</th><th>Evidence</th></tr></thead>
      <tbody>${DIMENSIONS.map((d) => { const r = c.ratings[d.key]; return `
        <tr><td><strong>${esc(d.label)}</strong><div class="muted small">${d.weight}% · ${esc(d.question)}</div></td>
        <td class="dots" title="${r.value} of 3">${dots(r.value)}</td>
        <td>${(d.weight * r.value / 3).toFixed(1)}</td>
        <td class="small">${esc(r.evidence)}</td></tr>`; }).join('')}</tbody>
    </table>
    <p class="muted small">Score = (35×Segment + 30×Persona + 25×FX + 10×Concentration) ÷ 3, from ratings of 0–3. The ratings are analyst judgments from public sources; the math is fixed.</p>
    <h2>Coverage</h2>
    <label class="row-label">Owner ${ownerSelect(c.id)}</label>
    <h2>Sources</h2>
    <ul class="sources">${c.sources.map((s) => `<li><a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\//, '').slice(0, 80))}</a></li>`).join('')}</ul>
  </section>`;
}

// ---------- Plan ----------
function renderPlan() {
  const t = today();
  const w = planningWindow(t);
  const unowned = unownedATier(S.conferences, S.ws.owners, t);
  const cl = clusters(S.conferences, t);
  const inW = S.conferences.filter((c) => inWindow(c, t)).sort((a, b) => a.start.localeCompare(b.start));
  const months = [];
  for (let m = `${t.slice(0, 7)}-01`; m < w.end; m = addMonths(m, 1)) {
  months.push(m.slice(0, 7));
}
  const rows = months.map((m) => {
    const evs = inW.filter((c) => (c.start < t ? t : c.start).slice(0, 7) === m);
    return `<div class="month"><div class="month-label">${esc(monthLabel(`${m}-01`))}</div><div class="month-events">${evs.map((c) => `
      <div class="plan-ev tier-row-${c.tier}">
        ${tierBadge(c.tier)} <a href="#/conference/${c.id}">${esc(c.name)} ${esc(c.edition)}</a>
        <span class="muted small">${esc(fmtRange(c.start, c.end))} · ${esc(c.city)}</span>
        ${ownerSelect(c.id, 'compact')}
      </div>`).join('') || '<span class="muted small">—</span>'}</div></div>`;
  }).join('');
 const reps = S.seed.reps.map((r) => {
  const owned = inW.filter((c) => S.ws.owners[c.id] === r.id);
  return `<tr>
    <td><strong>${esc(r.name)}</strong><div class="muted small">${esc(r.role)} · ${esc(r.homeBase)}</div></td>
    <td class="small">${esc(r.focus)}<div class="muted">${esc(r.regions)}</div></td>
    <td class="small">${owned.length
      ? owned.map((c) => `<div><strong>${esc(c.name)} ${esc(c.edition)}</strong><div class="muted">${esc(fmtRange(c.start, c.end))} · ${esc(c.city)}, ${esc(c.country)}</div></div>`).join('')
      : '<span class="muted">None</span>'}</td>
  </tr>`;
}).join('');
  return `
  <section class="pad">
    <h1>Coverage plan</h1>
    <p class="lede">The next 12 months (${esc(fmtDate(w.start))} – ${esc(fmtDate(w.end))}). The flags are prompts for the sales lead, not instructions.</p>
    <div class="flags">
      <h2>Possible under-investment</h2>
      ${unowned.length ? unowned.map((c) => `<div class="flag flag-a">${tierBadge('A')} <a href="#/conference/${c.id}">${esc(c.name)} ${esc(c.edition)}</a> · ${esc(fmtRange(c.start, c.end))}, ${esc(c.city)}. <strong>High ICP fit, no owner yet.</strong> ${ownerSelect(c.id, 'compact')}</div>`).join('') : '<p class="muted small">Every A-tier event in the window has an owner.</p>'}
      <h2>Combine the trip?</h2>
      ${cl.length ? cl.map((x) => `<div class="flag">${tierBadge(x.a.tier)} <a href="#/conference/${x.a.id}">${esc(x.a.name)}</a> (${esc(fmtRange(x.a.start, x.a.end))}, ${S.ws.owners[x.a.id] ? esc(repName(S.ws.owners[x.a.id])) : 'no owner'}) and ${tierBadge(x.b.tier)} <a href="#/conference/${x.b.id}">${esc(x.b.name)}</a> (${esc(fmtRange(x.b.start, x.b.end))}, ${S.ws.owners[x.b.id] ? esc(repName(S.ws.owners[x.b.id])) : 'no owner'}): both in ${esc(x.city)}, ${x.gapDays} days apart.</div>`).join('') : '<p class="muted small">No A/B events in the same city within 14 days.</p>'}
    </div>
    <h2>By month</h2>
    <div class="months">${rows}</div><h2>Sample coverage assignments</h2>
<p class="muted small">Fictional sample team. These are seeded examples of assignments made by a sales lead; the prototype does not auto-assign or recommend reps. Availability, visa and other travel constraints are not modeled in this prototype.</p>
<table class="reps"><thead><tr><th>Rep</th><th>Focus</th><th>Sample assignments in the window</th></tr></thead><tbody>${reps}</tbody></table>
  </section>`;
}

// ---------- Capture ----------
function captureConference() {
  if (!S.draft.conferenceId) {
    const cur = currentConference(S.conferences, S.ws.owners, S.ws.currentUser, today());
    S.draft.conferenceId = cur?.id || '';
  }
  return confById(S.draft.conferenceId);
}

function renderCapture() {
  const d = S.draft;
  const conf = captureConference();
  const t = today();
  const live = S.conferences.filter((c) => isHappening(c, t));
  const others = S.conferences.filter((c) => !isHappening(c, t)).sort((a, b) => a.name.localeCompare(b.name));
  const companies = [...new Set(S.ws.contacts.flatMap((c) => [c.company, ...(c.history || []).map((h) => h.company)]))].sort();
  const mine = conf ? S.ws.encounters.filter((e) => e.conferenceId === conf.id && e.edition === conf.edition && e.rep === S.ws.currentUser).slice().reverse().sort((a, b) => b.date.localeCompare(a.date)) : [];
  return `
  <section class="pad capture">
    <div class="capture-head">
      <label>At <select data-action="capture-conf" aria-label="Conference">
        <option value="">Pick the conference you're at</option>
        ${live.length ? `<optgroup label="Happening today">${live.map((c) => `<option value="${c.id}" ${c.id === d.conferenceId ? 'selected' : ''}>${esc(c.name)} ${esc(c.edition)}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Other events">${others.map((c) => `<option value="${c.id}" ${c.id === d.conferenceId ? 'selected' : ''}>${esc(c.name)} ${esc(c.edition)}</option>`).join('')}</optgroup>
      </select></label>
      <span class="muted small">as ${esc(repName(S.ws.currentUser))} · ${esc(fmtDay(t))}</span>
    </div>
    ${S.lastSaved ? `<div class="saved">✓ ${esc(S.lastSaved.message)} <a href="#/contact/${S.lastSaved.contactId}">Open profile</a></div>` : ''}
    <form id="capture-form" autocomplete="off" novalidate>
      <label class="field">Name <span class="req">required</span><input name="name" data-draft="name" value="${esc(d.name)}" placeholder="First and last name" autocapitalize="words"></label>
      <label class="field">Company <span class="req">required</span><input name="company" data-draft="company" value="${esc(d.company)}" list="companies" placeholder="Company" autocapitalize="words"></label>
      <datalist id="companies">${companies.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div id="matches"></div>
      <div class="field">Outcome <span class="req">required</span>
        <div class="outcomes" role="group" aria-label="Outcome">${OUTCOMES.map((o) => `<button type="button" data-action="outcome" data-v="${o}" class="${d.outcome === o ? 'on' : ''}">${o}</button>`).join('')}</div>
      </div>
      ${d.outcome === 'Next step agreed' ? `
      <div class="nextstep">
        <label class="field">Next step<input data-draft="nextStep" value="${esc(d.nextStep)}" placeholder="e.g. CFO call next week"></label>
        <label class="field due">Due date <span class="muted small">optional</span><input type="date" data-draft="due" value="${esc(d.due)}"></label>
      </div>` : ''}
      <details class="optional" open>
        <summary>Optional: title, email, note</summary>
        <label class="field">Job title<input data-draft="title" value="${esc(d.title)}" placeholder="e.g. Head of Payments"></label>
        <label class="field">Email<input type="email" data-draft="email" value="${esc(d.email)}" placeholder="Strongest match key, if you have it" inputmode="email" autocapitalize="off"></label>
        <label class="field">Note<textarea data-draft="note" rows="3" placeholder="What they said: needs, objections, who decides, timing. Phone dictation works here.">${esc(d.note)}</textarea></label>
      </details>
      <div class="save-bar"><button type="button" id="save-btn" data-action="save-capture" class="primary">Save</button>
      <span class="muted small" id="save-hint"></span></div>
    </form>
    <h2>Your captures at ${conf ? `${esc(conf.name)} ${esc(conf.edition)}` : 'this event'}</h2>
    ${mine.length ? `<ul class="today-list">${mine.map((e) => { const c = contactById(e.contactId); return `<li><a href="#/contact/${c.id}">${esc(c.name)}</a> <span class="muted">${esc(c.company)}</span> <span class="outcome-tag">${esc(e.outcome)}</span> <span class="muted small">${e.date === t ? 'today' : esc(fmtDay(e.date))}</span></li>`; }).join('')}</ul>` : '<p class="muted small">Nothing captured here yet.</p>'}
  </section>`;
}

// Recompute suggestions while typing without re-rendering the form (so the keyboard stays open).
function resolveLink(matches) {
  const d = S.draft;
  if (d.link && !matches.some((m) => m.contact.id === d.link.contactId)) d.link = null;
  if (d.link && d.link.auto && !matches.some((m) => m.contact.id === d.link.contactId && LEVELS[m.level].order <= 1)) d.link = null;
  if (!d.link) {
    const auto = matches.find((m) => (m.level === 'certain' || m.level === 'strong') && !d.rejected.includes(m.contact.id));
    if (auto) d.link = { contactId: auto.contact.id, level: auto.level, auto: true };
  }
}

function updateMatches() {
  const box = document.getElementById('matches');
  if (!box) return;
  const d = S.draft;
  const matches = findMatches(d, S.ws.contacts);
  resolveLink(matches);
  box.innerHTML = matches.map((m) => {
    const v = contactView(m.contact);
    const linked = d.link?.contactId === m.contact.id;
    const rejected = d.rejected.includes(m.contact.id);
    const last = v.last ? `Last met ${esc(fmtDate(v.last.date))} at ${esc(confName(v.last))} by ${esc(repName(v.last.rep))}` : '';
    let actions = '';
    if (m.level === 'nameOnly') actions = '<div class="muted small">Add the company to check whether this is them.</div>';
    else if (rejected) actions = `<div class="muted small">Marked as a different person. <button type="button" class="link-btn" data-action="unreject" data-id="${m.contact.id}">Undo</button></div>`;
    else if (linked) actions = `<div class="linked">✓ ${m.level === 'jobChange' ? 'Same person, new company: their company history will be kept' : m.level === 'certain' ? 'Linked automatically: same email' : 'Will be saved to this contact'} <button type="button" class="link-btn" data-action="unlink" data-id="${m.contact.id}">${m.level === 'jobChange' ? 'Undo' : 'Not them'}</button></div>`;
    else if (m.level === 'jobChange') actions = `<div class="q">Same person, new company? <button type="button" data-action="link" data-id="${m.contact.id}" data-level="jobChange">Same person, new company</button> <button type="button" data-action="reject" data-id="${m.contact.id}">Different person</button></div>`;
    else actions = `<div class="q">Same person? <button type="button" data-action="link" data-id="${m.contact.id}" data-level="${m.level}">Yes, link</button> <button type="button" data-action="reject" data-id="${m.contact.id}">No</button></div>`;
    return `<div class="match match-${m.level}${linked ? ' is-linked' : ''}">
      <div class="match-top"><span class="level">${esc(LEVELS[m.level].label)}</span> <span class="muted small">${esc(m.why)}</span></div>
      <div><strong>${esc(m.contact.name)}</strong> · ${esc(m.contact.title || '')}${m.contact.title ? ', ' : ''}${esc(m.contact.company)}</div>
      <div class="small muted">${last}</div>
      <div class="small">${stateBadge(v.eff.state, v.eff.source === 'override')} ${v.nudge ? `<span class="nudge-inline nudge-${v.nudge.level}"><strong>${esc(v.nudge.label)}:</strong> ${esc(v.nudge.text)}</span>` : ''}</div>
      ${actions}
    </div>`;
  }).join('');
  const ready = d.conferenceId && d.name.trim() && d.company.trim() && d.outcome;
  const btn = document.getElementById('save-btn');
  btn.disabled = !ready;
  const pending = matches.find((m) => m.level === 'jobChange' && !d.rejected.includes(m.contact.id) && d.link?.contactId !== m.contact.id);
  document.getElementById('save-hint').textContent = !ready
    ? 'Needs the conference, name, company and outcome.'
    : d.link ? `Saves to ${contactById(d.link.contactId).name}'s history.` : pending ? 'Answer the "same person?" question first, or it saves as a new contact.' : 'Saves as a new contact.';
}

function saveCapture() {
  const d = S.draft;
  const conf = confById(d.conferenceId);
  if (!conf || !d.name.trim() || !d.company.trim() || !d.outcome) return;
  const t = today();
  let c;
  let message;
  if (d.link) {
    c = contactById(d.link.contactId);
    if (d.link.level === 'jobChange') {
      // A job change is a fact, not a state change (D10). The old email moves to history and isn't exported (C9).
      c.history = [...(c.history || []), { company: c.company, title: c.title, email: c.email, until: t }];
      message = `Saved to ${c.name}. Job change recorded: ${c.company} → ${d.company.trim()}.`;
      c.company = d.company.trim();
      c.title = d.title.trim();
      c.email = d.email.trim() || null;
    } else {
      if (d.title.trim()) c.title = d.title.trim();
      if (d.email.trim()) c.email = d.email.trim();
      message = `Saved to ${c.name}'s history (${LEVELS[d.link.level].label.toLowerCase()} match).`;
    }
  } else {
    c = { id: uid('c'), name: d.name.trim(), company: d.company.trim(), title: d.title.trim(), email: d.email.trim() || null, history: [], override: null, export: null, aiAction: null };
    S.ws.contacts.push(c);
    message = `Saved ${c.name} as a new contact.`;
  }
  S.ws.encounters.push({
    id: uid('e'), contactId: c.id, conferenceId: conf.id, edition: conf.edition, date: t, rep: S.ws.currentUser,
    outcome: d.outcome, company: c.company, title: c.title,
    nextStep: d.outcome === 'Next step agreed' && d.nextStep.trim() ? { text: d.nextStep.trim(), due: d.due || null, status: 'Open', statusDate: null } : null,
    note: d.note.trim(),
  });
  save();
  S.lastSaved = { contactId: c.id, message };
  S.draft = freshDraft(conf.id);
  render();
  window.scrollTo(0, 0);
  toast('Saved');
}

// ---------- Contacts & export ----------
function renderContacts() {
  const views = S.ws.contacts.map(contactView).sort((a, b) => (b.last?.date || '').localeCompare(a.last?.date || '') || a.c.name.localeCompare(b.c.name));
  const q = S.contactQuery.trim().toLowerCase();
  const shown = views.filter((v) => (S.contactFilter === 'all' || v.eff.state === S.contactFilter) && (!q || `${v.c.name} ${v.c.company}`.toLowerCase().includes(q)));
  const chk = S.exportCheck;
  return `
  <section class="pad">
    <h1>Contacts</h1>
    <p class="lede">Everyone met at conferences, across reps. States come from rules; open a contact for the reasons and the AI read.</p>
    <div class="filters">
      <input type="search" placeholder="Search name or company" value="${esc(S.contactQuery)}" data-filter="contactQuery" aria-label="Search contacts">
      <div class="seg" role="group" aria-label="State">${['all', ...STATES].map((s) => `<button type="button" data-action="cfilter" data-v="${s}" class="${S.contactFilter === s ? 'on' : ''}">${s === 'all' ? 'All' : s} <small>${s === 'all' ? views.length : views.filter((v) => v.eff.state === s).length}</small></button>`).join('')}</div>
    </div>
    <div class="export-bar">
      <button type="button" data-action="select-shown">Select shown</button>
      <button type="button" data-action="select-none">Clear</button>
      <button type="button" class="primary" data-action="export" ${S.selected.size ? '' : 'disabled'}>Download HubSpot CSV (${S.selected.size})</button>
    </div>
    ${chk ? `<div class="warn"><strong>Before you export:</strong><ul>${chk.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <button type="button" class="primary" data-action="export-anyway">Download anyway</button> <button type="button" data-action="export-cancel">Cancel</button></div>` : ''}
    <div class="contact-list">
      ${shown.map((v) => `
      <div class="contact-row">
        <input type="checkbox" data-action="select" data-id="${v.c.id}" ${S.selected.has(v.c.id) ? 'checked' : ''} aria-label="Select ${esc(v.c.name)} for export">
        <div class="cr-main"><a href="#/contact/${v.c.id}"><strong>${esc(v.c.name)}</strong></a> <span class="muted">${esc(v.c.title || '')}${v.c.title ? ', ' : ''}${esc(v.c.company)}</span>
          <div class="small">${stateBadge(v.eff.state, v.eff.source === 'override')} ${v.nudge ? `<span class="nudge-inline nudge-${v.nudge.level}"><strong>${esc(v.nudge.label)}</strong></span>` : ''}
          <span class="muted">· ${v.encs.length} encounter${v.encs.length === 1 ? '' : 's'} · last ${v.last ? `${esc(fmtDate(v.last.date))}, ${esc(confName(v.last))}` : '—'}</span></div>
        </div>
        <div class="cr-side small muted">${esc(exportStatus(v.c))}</div>
      </div>`).join('') || '<p class="muted">No contacts match.</p>'}
    </div>
  </section>`;
}

function exportRow(c) {
  const v = contactView(c);
  const cache = S.ws.aiCache[c.id];
  const read = cache && cache.sig === signature(c, v.encs, v.rule) ? cache.result : null;
  const series = [...new Set(v.encs.map(confName))];
  return {
    contact: c,
    latestConference: v.last ? confName(v.last) : '',
    latestDate: v.last?.date || '',
    conferencesMetAt: series.join('; '),
    state: v.eff.state,
    stateBasis: v.eff.source === 'override' ? `Rep override: ${v.eff.override.reason} (rules: ${v.rule.state})` : `Rules: ${v.rule.reasons.join('; ')}`,
    action: c.aiAction || read?.suggestedAction || (v.nudge ? `${v.nudge.label}: ${v.nudge.text}` : ''),
    summary: read?.summary || '',
    rep: v.last ? repName(v.last.rep) : '',
  };
}

function downloadExport(ids) {
  const contacts = ids.map(contactById).filter(Boolean);
  const csv = buildHubspotCsv(contacts.map(exportRow));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hubspot-contacts-${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  for (const c of contacts) c.export = { date: today(), encounterCount: encountersOf(c.id).length, company: c.company };
  save();
  S.exportCheck = null;
  toast(`Exported ${contacts.length} contact${contacts.length === 1 ? '' : 's'} for HubSpot import`);
}

function startExport(ids) {
  const warnings = ids.map(contactById).filter(Boolean).flatMap(exportWarnings);
  if (warnings.length) { S.exportCheck = warnings; S.exportIds = ids; render(); return; }
  downloadExport(ids);
  render();
}

// ---------- Contact profile ----------
function renderProfile(id) {
  const c = contactById(id);
  if (!c) return '<section class="pad"><p>Contact not found. <a href="#/contacts">Back</a></p></section>';
  const v = contactView(c);
  const aiCache = S.ws.aiCache[c.id];
const suggestedOverrideReason =
  aiCache && aiCache.sig === signature(c, v.encs, v.rule)
    ? (aiCache.result?.disagreement || '')
    : '';
  const prev = (c.history || []).slice().reverse();
  const overrideForm = S.overrideFor === c.id ? `
    <div class="override-form">
      <label>New state <select id="ov-state">
  <option value="" selected disabled>Choose state…</option>
  ${STATES.filter((s) => s !== v.rule.state).map((s) => `<option>${s}</option>`).join('')}
</select></label>
      <label>Reason <input id="ov-reason" value="${esc(suggestedOverrideReason)}" placeholder="Why the rules are wrong here (required)"></label>
      <button type="button" class="primary" data-action="override-save" data-id="${c.id}">Save override</button>
      <button type="button" data-action="override-cancel">Cancel</button>
    </div>` : '';
  return `
  <section class="pad narrow">
    <a href="#/contacts" class="back">← Contacts</a>
    <h1>${esc(c.name)}</h1>
    <p>${esc(c.title || '')}${c.title ? ', ' : ''}<strong>${esc(c.company)}</strong>
      ${prev.length ? `<br><span class="muted small">Previously: ${prev.map((h) => `${esc(h.title || '')}${h.title ? ', ' : ''}${esc(h.company)}${h.until ? ` (until ${esc(fmtDate(h.until))})` : ''}`).join(' · ')}</span>` : ''}
      <br><span class="small ${c.email ? '' : 'muted'}">${c.email ? esc(c.email) : `No current email${prev.find((h) => h.email) ? ` (last known at ${esc(prev.find((h) => h.email).company)}: ${esc(prev.find((h) => h.email).email)}, not exported)` : ''}`}</span></p>
    ${prev.length ? `<div class="fact">Moved from ${esc(prev[0].company)} to ${esc(c.company)}. A job change is a fact; it doesn't change the state by itself.</div>` : ''}

    <div class="panel state-panel">
      <div class="state-head">${stateBadge(v.eff.state, v.eff.source === 'override')}
        ${v.eff.source === 'override'
          ? `<button type="button" class="link-btn" data-action="override-clear" data-id="${c.id}">Clear override</button>`
          : `<button type="button" class="link-btn" data-action="override-open" data-id="${c.id}">Override…</button>`}</div>
      ${v.eff.source === 'override' ? `<p class="small"><strong>Rep override</strong> by ${esc(repName(v.eff.override.by))} on ${esc(fmtDate(v.eff.override.date))}: ${esc(v.eff.override.reason)}</p>` : ''}
      <p class="small muted">${v.eff.source === 'override' ? `Rules say <strong>${esc(v.rule.state)}</strong> because:` : 'Why (rules):'}</p>
      <ul class="reasons">${v.rule.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${overrideForm}
      ${nudgeHtml(v.nudge)}
    </div>

    <div id="ai-panel">${aiPanel(c, v)}</div>

    <h2>Timeline <span class="muted small">${v.encs.length} encounter${v.encs.length === 1 ? '' : 's'} · ${new Set(v.encs.map((e) => e.conferenceId)).size} conference${new Set(v.encs.map((e) => e.conferenceId)).size === 1 ? '' : 's'} · ${new Set(v.encs.map((e) => e.rep)).size} rep${new Set(v.encs.map((e) => e.rep)).size === 1 ? '' : 's'}</span></h2>
    <ol class="timeline">${v.encs.slice().reverse().map((e) => `
      <li>
        <div class="tl-head"><strong>${esc(fmtDate(e.date))}</strong> · ${esc(confName(e))} · ${esc(repName(e.rep))} <span class="outcome-tag">${esc(e.outcome)}</span> <span class="muted small">${esc(e.id)}</span></div>
        ${e.company && e.company !== c.company ? `<div class="small muted">At ${esc(e.company)} then</div>` : ''}
        ${e.note ? `<blockquote>${esc(e.note)}</blockquote>` : '<div class="muted small">No note</div>'}
        ${e.nextStep ? `<div class="step small">Next step: <strong>${esc(e.nextStep.text)}</strong>${e.nextStep.due ? ` · due ${esc(fmtDay(e.nextStep.due))}` : ''}
          <select data-action="step-status" data-enc="${e.id}" aria-label="Next step status">${STEP_STATUSES.map((s) => `<option ${s === e.nextStep.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          ${e.nextStep.statusDate ? `<span class="muted">(${esc(fmtDate(e.nextStep.statusDate))})</span>` : ''}${e.nextStep.statusNote ? ` <span class="muted">${esc(e.nextStep.statusNote)}</span>` : ''}</div>` : ''}
      </li>`).join('')}</ol>

    <h2>HubSpot</h2>
    <p class="small">${esc(exportStatus(c))} <button type="button" data-action="export-one" data-id="${c.id}">Export this contact (CSV)</button></p>
  </section>`;
}

function aiPanel(c, v) {
  const sig = signature(c, v.encs, v.rule);
  const cache = S.ws.aiCache[c.id];
  const err = S.aiErrors[c.id];
  const head = `<div class="ai-head"><strong>AI read</strong> <span class="muted small">Review before acting</span>
    <button type="button" class="link-btn" data-action="ai-refresh" data-id="${c.id}">Refresh</button></div>`;
  if (S.aiPending[c.id]) return `<div class="panel ai">${head}<p class="muted">Reading the notes…</p></div>`;
  if (cache && cache.sig === sig) {
    const r = cache.result;
    return `<div class="panel ai">${head}
      ${r.disagreement ? `<div class="disagree"><strong>Notes point a different way from the rules:</strong> ${esc(r.disagreement)} <button type="button" class="link-btn" data-action="override-open" data-id="${c.id}">Review state →</button></div>` : ''}
      ${r.notEnoughInfo ? '<div class="thin">Not enough information to read this relationship yet.</div>' : ''}
      <p>${esc(r.summary)}</p>
      ${r.evidence.length ? `<ul class="evidence">${r.evidence.map((x) => { const e = v.encs.find((y) => y.id === x.encounterId); return `<li><span class="muted small">${esc(fmtDate(e.date))} · ${esc(confName(e))}:</span> ${esc(x.point)}</li>`; }).join('')}</ul>` : ''}
      <label class="field">Suggested next action <span class="muted small">edit it; your version goes into the HubSpot export</span>
        <textarea data-action="ai-action" data-id="${c.id}" rows="2">${esc(c.aiAction ?? r.suggestedAction)}</textarea></label>
      <div class="muted small">${esc(r.model)} · ${(r.elapsedMs / 1000).toFixed(1)} s${r.droppedEvidence ? ` · ${r.droppedEvidence} evidence point(s) dropped: they cited encounters this contact doesn't have` : ''}</div>
    </div>`;
  }
  if (err && err.sig === sig) {
    return `<div class="panel ai">${head}<p class="muted">AI read unavailable (${esc(err.message)}). The state, reasons, timeline and notes are unaffected.</p></div>`;
  }
  return `<div class="panel ai">${head}<p class="muted">Reading the notes…</p></div>`;
}

function maybeFetchRead(id) {
  const c = contactById(id);
  if (!c) return;
  const v = contactView(c);
  const sig = signature(c, v.encs, v.rule);
  const cache = S.ws.aiCache[c.id];
  const err = S.aiErrors[c.id];
  if ((cache && cache.sig === sig) || (err && err.sig === sig) || S.aiPending[c.id]) return;
  fetchRead(c);
}

async function fetchRead(c) {
  const v = contactView(c);
  const sig = signature(c, v.encs, v.rule);
  S.aiPending[c.id] = true;
  delete S.aiErrors[c.id];
  refreshAiPanel(c.id);
  const payload = buildPayload({ contact: c, encounters: v.encs, rule: v.rule, eff: v.eff, confName, repName, today: today() });
  const res = await requestRead(payload);
  delete S.aiPending[c.id];
  const result = res.ok ? validateRead(res.data, v.encs.map((e) => e.id)) : null;
  if (result) {
    S.ws.aiCache[c.id] = { sig, result, at: todayReal() };
    c.aiAction = null; // a new read replaces an older edited action
    save();
  } else {
    S.aiErrors[c.id] = { sig, message: res.ok ? 'unexpected response' : res.error };
  }
  refreshAiPanel(c.id);
}

function refreshAiPanel(id) {
  const { page, id: cur } = route();
  if (page !== 'contact' || cur !== id) return;
  const box = document.getElementById('ai-panel');
  const c = contactById(id);
  if (box && c) box.innerHTML = aiPanel(c, contactView(c));
}

// ---------- events ----------
view.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.draft) {
    S.draft[el.dataset.draft] = el.value;
    S.lastSaved = null;
    if (['name', 'company', 'email'].includes(el.dataset.draft)) updateMatches();
    else if (document.getElementById('save-btn')) updateMatches();
  } else if (el.dataset.filter === 'q' || el.dataset.filter === 'contactQuery') {
    if (el.dataset.filter === 'q') S.filters.q = el.value; else S.contactQuery = el.value;
    const pos = el.selectionStart;
    render();
    const again = view.querySelector(`[data-filter="${el.dataset.filter}"]`);
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  } else if (el.dataset.action === 'ai-action') {
    const c = contactById(el.dataset.id);
    c.aiAction = el.value;
    save();
  }
});

view.addEventListener('change', (ev) => {
  const el = ev.target;
  const a = el.dataset.action;
  if (el.dataset.filter && el.dataset.filter !== 'q' && el.dataset.filter !== 'contactQuery') {
    S.filters[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
    render();
  } else if (a === 'assign') {
    if (el.value) S.ws.owners[el.dataset.conf] = el.value; else delete S.ws.owners[el.dataset.conf];
    save();
    const c = confById(el.dataset.conf);
    toast(el.value ? `${repName(el.value)} now owns ${c.name} ${c.edition}` : `${c.name} ${c.edition} has no owner`);
    render();
  } else if (a === 'capture-conf') {
    S.draft.conferenceId = el.value;
    render();
  } else if (a === 'step-status') {
    const e = S.ws.encounters.find((x) => x.id === el.dataset.enc);
    e.nextStep.status = el.value;
    e.nextStep.statusDate = el.value === 'Open' ? null : today();
    e.nextStep.statusNote = null;
    save();
    render();
  } else if (a === 'select') {
    if (el.checked) S.selected.add(el.dataset.id); else S.selected.delete(el.dataset.id);
    S.exportCheck = null;
    render();
  }
});

view.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || el.type === 'checkbox' || el.tagName === 'TEXTAREA') return;
  const a = el.dataset.action;
  const d = S.draft;
  const actions = {
    tier: () => { S.filters.tier = el.dataset.v; render(); },
    cfilter: () => { S.contactFilter = el.dataset.v; render(); },
    outcome: () => { d.outcome = el.dataset.v; S.lastSaved = null; render(); },
    link: () => { d.link = { contactId: el.dataset.id, level: el.dataset.level }; d.rejected = d.rejected.filter((x) => x !== el.dataset.id); updateMatches(); },
    unlink: () => { d.rejected.push(el.dataset.id); d.link = null; updateMatches(); },
    reject: () => { d.rejected.push(el.dataset.id); if (d.link?.contactId === el.dataset.id) d.link = null; updateMatches(); },
    unreject: () => { d.rejected = d.rejected.filter((x) => x !== el.dataset.id); updateMatches(); },
    'save-capture': saveCapture,
    'select-shown': () => { view.querySelectorAll('[data-action="select"]').forEach((x) => S.selected.add(x.dataset.id)); S.exportCheck = null; render(); },
    'select-none': () => { S.selected.clear(); S.exportCheck = null; render(); },
    export: () => startExport([...S.selected]),
    'export-anyway': () => { downloadExport(S.exportIds); render(); },
    'export-cancel': () => { S.exportCheck = null; render(); },
    'export-one': () => startExportOne(el.dataset.id),
    'override-open': () => { S.overrideFor = el.dataset.id; render(); },
    'override-cancel': () => { S.overrideFor = null; render(); },
   'override-save': () => {
  const state = document.getElementById('ov-state').value;
  const reason = document.getElementById('ov-reason').value.trim();
  if (!state) { toast('Choose a new state'); return; }
  if (!reason) { toast('Add a short reason for the override'); return; }
  contactById(el.dataset.id).override = { state, reason, by: S.ws.currentUser, date: today() };
      S.overrideFor = null; save(); render();
    },
    'override-clear': () => { contactById(el.dataset.id).override = null; save(); render(); },
    'ai-refresh': () => { const c = contactById(el.dataset.id); delete S.ws.aiCache[c.id]; fetchRead(c); },
    reset: resetDemo,
  };
  if (actions[a]) { ev.preventDefault(); actions[a](); }
});

function startExportOne(id) {
  const warnings = exportWarnings(contactById(id));
  if (warnings.length && !window.confirm(`Before you export:\n\n${warnings.join('\n')}\n\nDownload anyway?`)) return;
  downloadExport([id]);
  render();
}

function resetDemo() {
  if (!window.confirm('Reset demo data? This removes everything you changed in this browser and restores the sample data.')) return;
  store.clearWorkspace();
  S.ws = store.freshWorkspace(S.seed);
  S.notice = null;
  S.selected.clear();
  S.aiErrors = {};
  S.draft = freshDraft();
  S.lastSaved = null;
  save();
  render();
  toast('Demo data reset');
}

document.getElementById('user').addEventListener('change', (ev) => {
  S.ws.currentUser = ev.target.value;
  S.draft = freshDraft();
  S.lastSaved = null;
  save();
  render();
});
document.getElementById('date-chip').addEventListener('click', () => {
  S.ws.useRealDate = !S.ws.useRealDate;
  S.draft = freshDraft();
  save();
  render();
});
document.getElementById('reset').addEventListener('click', resetDemo);
document.getElementById('banner').addEventListener('click', (ev) => { if (ev.target.closest('[data-action="reset"]')) resetDemo(); });
window.addEventListener('hashchange', () => { S.overrideFor = null; S.exportCheck = null; render(); window.scrollTo(0, 0); });

// ---------- start ----------
(async function start() {
  try {
    const { conferences, warnings, seed } = await store.loadStatic();
    S.conferences = conferences;
    S.warnings = warnings;
    S.seed = seed;
    const { ws, notice } = store.loadWorkspace(seed);
    S.ws = ws;
    S.notice = notice;
    S.draft = freshDraft();
    if (!notice) save();
    render();
  } catch (err) {
    view.innerHTML = `<section class="pad"><h1>Couldn't load the data</h1><p>${esc(err.message)}</p></section>`;
  }
})();
