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

// A/B events in the same city whose dates are within 14 days of each other → "combine the trip?".
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

// The event the capture screen should pre-select: one happening today, preferring the user's own.
export function currentConference(conferences, owners, userId, today) {
  const live = conferences.filter((c) => isHappening(c, today));
  return live.find((c) => owners[c.id] === userId) || live[0] || null;
}
