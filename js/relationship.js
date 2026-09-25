// Relationship state rules (PRODUCT_DECISIONS §10.1, with C7) and nudges (§11, with C8).
// Rules set the state label; AI never does. A rep can override it with a reason.
import { addMonths, daysBetween, fmtDate, fmtDay } from './util.js';

export const OUTCOMES = ['No clear intent', 'Interested', 'Next step agreed'];
export const RANK = { 'No clear intent': 0, Interested: 1, 'Next step agreed': 2 };
export const STATES = ['Warming', 'Stalled', 'Low intent', 'Early'];
export const STEP_STATUSES = ['Open', 'Done', "Didn't happen"];

export const QUIET_MONTHS = 6;
export const LOW_INTENT_MIN_ENCOUNTERS = 3;
export const LOW_INTENT_MIN_MONTHS = 9;
export const OVERDUE_DAYS_WITHOUT_DUE_DATE = 14;

export function byDate(encounters) {
  return [...encounters].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// "Meaningful" = an encounter at Interested or above, or an agreed next step that happened.
export function lastMeaningful(encounters) {
  const dates = [];
  for (const e of encounters) {
    if (RANK[e.outcome] >= 1) dates.push(e.date);
    if (e.nextStep?.status === 'Done' && e.nextStep.statusDate) dates.push(e.nextStep.statusDate);
  }
  return dates.sort().pop() || null;
}

const months = (a, b) => Math.round(daysBetween(a, b) / 30.44);

export function computeState(encounters, today) {
  const e = byDate(encounters);
  if (e.length === 0) return { state: 'Early', reasons: ['No encounters yet'] };
  if (e.length === 1) return { state: 'Early', reasons: [`One encounter so far (${fmtDate(e[0].date)})`] };

  const last = e[e.length - 1];
  const prev = e[e.length - 2];
  const lm = lastMeaningful(e);
  const recent = !!lm && addMonths(lm, QUIET_MONTHS) > today;
  const happened = e.filter((x) => x.nextStep?.status === 'Done');
  const wentUp = RANK[last.outcome] > RANK[prev.outcome];

  // 2. Warming
  if (RANK[last.outcome] >= RANK[prev.outcome] && (happened.length || wentUp) && recent) {
    const reasons = [];
    if (wentUp) reasons.push(`Commitment went up (${prev.outcome} → ${last.outcome})`);
    for (const h of happened) reasons.push(`"${h.nextStep.text}" happened (${fmtDate(h.nextStep.statusDate)})`);
    reasons.push(`Last meaningful contact ${fmtDate(lm)}, within ${QUIET_MONTHS} months`);
    return { state: 'Warming', reasons };
  }

  // 3. Low intent
  const neverPastInterested = e.every((x) => RANK[x.outcome] <= 1);
  if (e.length >= LOW_INTENT_MIN_ENCOUNTERS && addMonths(e[0].date, LOW_INTENT_MIN_MONTHS) <= last.date && neverPastInterested) {
    return {
      state: 'Low intent',
      reasons: [`${e.length} encounters over ${months(e[0].date, last.date)} months`, 'Never past "Interested": no next step ever agreed'],
    };
  }

  // 4. Stalled
  const realInterestBefore = e.slice(0, -1).some((x) => RANK[x.outcome] >= 1);
  const didnt = e.filter((x) => x.nextStep?.status === "Didn't happen");
  const dropped = RANK[last.outcome] < RANK[prev.outcome];
  if (realInterestBefore && (didnt.length || dropped || !recent)) {
    const reasons = [];
    for (const d of didnt) reasons.push(`"${d.nextStep.text}" didn't happen`);
    if (dropped) reasons.push(`Commitment dropped (${prev.outcome} → ${last.outcome})`);
    if (!recent) reasons.push(lm ? `No meaningful contact since ${fmtDate(lm)} (${QUIET_MONTHS}+ months)` : 'No meaningful contact');
    return { state: 'Stalled', reasons };
  }

  // 5. Otherwise
  return { state: 'Early', reasons: [`${e.length} encounters, but not enough history yet to call a trajectory`] };
}

// The label the rep sees: the override if there is one, otherwise the rules.
export function effectiveState(contact, rule) {
  if (contact.override) return { state: contact.override.state, source: 'override', override: contact.override };
  return { state: rule.state, source: 'rules' };
}

// Open next steps. Overdue = past the explicit due date; with no due date, Open for more than 14 days (C8).
export function openSteps(encounters, today) {
  return byDate(encounters)
    .filter((e) => e.nextStep?.status === 'Open')
    .map((e) => {
      const due = e.nextStep.due || null;
      const age = daysBetween(e.date, today);
      const overdue = due ? today > due : age > OVERDUE_DAYS_WITHOUT_DUE_DATE;
      return { encounter: e, text: e.nextStep.text, due, agreed: e.date, ageDays: age, overdue };
    });
}

function stepPhrase(s) {
  if (s.overdue) return `"${s.text}" is overdue (agreed ${fmtDay(s.agreed)}${s.due ? `, due ${fmtDay(s.due)}` : `, open ${s.ageDays} days`})`;
  return `"${s.text}"${s.due ? `, due ${fmtDay(s.due)}` : ''}`;
}

// One nudge sized to the state: strong / medium / soft. Early gets a nudge only from an open next step (D9).
export function nudgeFor(contact, encounters, today) {
  const rule = computeState(encounters, today);
  const eff = effectiveState(contact, rule);
  const steps = openSteps(encounters, today);
  const overdue = steps.find((s) => s.overdue);
  const e = byDate(encounters);
  const last = e[e.length - 1];

  if (eff.state === 'Warming') {
    const text = steps.length
      ? `Make sure ${stepPhrase(overdue || steps[steps.length - 1])} happens.`
      : `Nothing booked since ${fmtDay(lastMeaningful(e) || last.date)}. Propose the next step.`;
    return { level: 'strong', label: 'Act now', text };
  }
  if (eff.state === 'Stalled') {
    const why = eff.source === 'override' ? eff.override.reason : rule.reasons[0];
    return { level: 'medium', label: 'Re-engage', text: `${why}. Try a new angle.${overdue ? ` Also: ${stepPhrase(overdue)}.` : ''}` };
  }
  if (eff.state === 'Low intent') {
    const m = e.length > 1 ? months(e[0].date, last.date) : 0;
    return { level: 'soft', label: 'Keep light', text: `${e.length} meeting${e.length === 1 ? '' : 's'} in ${m} months, no next step. Stay in touch lightly; don't prioritize meetings.` };
  }
  if (overdue) return { level: 'strong', label: 'Overdue', text: `${stepPhrase(overdue)}.` };
  if (steps.length) return { level: 'medium', label: 'Next step', text: `${stepPhrase(steps[steps.length - 1])}.` };
  return null;
}
