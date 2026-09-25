// Coverage is deterministic flags, not a score (PRODUCT_DECISIONS §6, D2).
import { addMonths, daysBetween } from './util.js';

export const CLUSTER_MAX_GAP_DAYS = 14; // WORKING threshold

export function planningWindow(today) {
  return { start: today, end: addMonths(today, 12) };
}

// An event is in the window if it hasn't ended yet and starts before the window closes.
export function inWindow(conf, today) {
  if (!conf.start) return false;
  const w = planningWindow(today);
  return conf.end >= w.start && conf.start < w.end;
}

export function isHappening(conf, today) {
  return !!conf.start && conf.start <= today && today <= conf.end;
}

export function unownedATier(conferences, owners, today) {
  return conferences.filter((c) => c.tier === 'A' && inWindow(c, today) && !owners[c.id]);
}

// A/B events in the same city whose dates are within 14 days of each other → "Trip cluster".
// Prototype limit: same city only; short-haul neighbours are not modelled.
export function clusters(conferences, today) {
  const eligible = conferences
    .filter((c) => (c.tier === 'A' || c.tier === 'B') && inWindow(c, today))
    .sort((a, b) => a.start.localeCompare(b.start));
  const out = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) continue;
      const gap = Math.max(0, daysBetween(a.end, b.start));
      if (gap <= CLUSTER_MAX_GAP_DAYS) out.push({ a, b, gapDays: gap, city: a.city });
    }
  }
  return out;
}

export const BUSY_WINDOW_DAYS = 21; // "within 3 weeks"
export const BUSY_MIN_EVENTS = 3;

// "Busy stretch": 3+ Tier A/B events whose start dates fall within 3 weeks of each other, wherever they are.
// It flags concentrated coverage demand; combined travel is Trip cluster's job. Overlapping windows merge into
// one stretch. Tier C stays out, as in Trip cluster.
export function busyStretches(conferences, today) {
  const ab = conferences
    .filter((c) => (c.tier === 'A' || c.tier === 'B') && inWindow(c, today))
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const out = [];
  for (const first of ab) {
    const group = ab.filter((c) => c.start >= first.start && daysBetween(first.start, c.start) <= BUSY_WINDOW_DAYS);
    if (group.length < BUSY_MIN_EVENTS) continue;
    const last = out[out.length - 1];
    if (last && last.includes(first)) group.forEach((c) => { if (!last.includes(c)) last.push(c); });
    else out.push(group);
  }
  return out.map((events) => ({ events, start: events[0].start, end: events.reduce((m, c) => (c.end > m ? c.end : m), events[0].end) }));
}

// The event the capture screen should pre-select: one happening today, preferring the user's own.
export function currentConference(conferences, owners, userId, today) {
  const live = conferences.filter((c) => isHappening(c, today));
  return live.find((c) => owners[c.id] === userId) || live[0] || null;
}

// Capture records "I met this person at this conference", dated today. So only conferences happening today
// can be chosen: never one that hasn't started. Logging after an event would need an explicit encounter date;
// that is future work, and the app never invents one.
export function captureOptions(conferences, today) {
  return conferences.filter((c) => isHappening(c, today)).sort((a, b) => a.name.localeCompare(b.name));
}
