// ICP Fit: four ratings (0–3), weights 35/30/25/10, tiers A ≥ 75, B 55–74, C < 55 (PRODUCT_DECISIONS §4.3).
import { parseCSVObjects } from './csv.js';
import { isISODate } from './util.js';

export const DIMENSIONS = [
  { key: 'segment', label: 'Segment fit', weight: 35, question: 'Are the companies in the room the kind Grain sells to?' },
  { key: 'persona', label: 'Persona fit', weight: 30, question: 'Are the buyers or champions there, at the right seniority?' },
  { key: 'fx', label: 'FX / cross-border relevance', weight: 25, question: 'Is moving money across borders or currency risk central?' },
  { key: 'concentration', label: 'Relevant-audience concentration', weight: 10, question: 'What share of the room is Grain-relevant?' },
];

export const TIERS = {
  A: 'High ICP fit: prioritize for planning',
  B: 'Medium ICP fit: consider with additional reasons',
  C: 'Low ICP fit: deprioritize by default',
};

// Sum the weighted ratings first, then divide once. Computing each term separately (35*S/3 + …)
// produces 54.99999999999999 for two rating combinations that should be exactly 55.
export function icpScore(r) {
  return (35 * r.segment + 30 * r.persona + 25 * r.fx + 10 * r.concentration) / 3;
}

// The raw score is classified; rounding is for display only.
export function tierOf(score) {
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  return 'C';
}

export function displayScore(score) {
  return score.toFixed(1);
}

// Reads data/conferences.csv. A bad row becomes a visible warning instead of breaking the app.
export function loadConferences(csvText) {
  const conferences = [];
  const warnings = [];
  const seen = new Set();
  for (const row of parseCSVObjects(csvText)) {
    const label = `Line ${row._line}${row.name ? ` (${row.name})` : ''}`;
    const problems = [];
    if (!row.id) problems.push('missing id');
    if (!row.name) problems.push('missing name');
    if (row.id && seen.has(row.id)) problems.push(`duplicate id "${row.id}"`);
    const ratings = {};
    for (const d of DIMENSIONS) {
      const raw = row[`${d.key}_rating`];
      if (!/^[0-3]$/.test(raw ?? '')) problems.push(`${d.label} rating "${raw ?? ''}" is not 0–3`);
      ratings[d.key] = { value: Number(raw), evidence: row[`${d.key}_evidence`] || '' };
    }
    const confirmed = row.date_status === 'Confirmed';
    if (confirmed && !(isISODate(row.start_date) && isISODate(row.end_date))) problems.push('dates must be YYYY-MM-DD when status is Confirmed');
    if (confirmed && row.end_date < row.start_date) problems.push('end date is before start date');
    if (problems.length) { warnings.push(`${label}: ${problems.join('; ')}. Row skipped.`); continue; }
    seen.add(row.id);
    const values = Object.fromEntries(DIMENSIONS.map((d) => [d.key, ratings[d.key].value]));
    const score = icpScore(values);
    conferences.push({
      id: row.id,
      name: row.name,
      edition: row.edition,
      start: confirmed ? row.start_date : '',
      end: confirmed ? row.end_date : '',
      dateStatus: row.date_status || 'Not yet announced',
      typicalTiming: row.typical_timing,
      city: row.city,
      country: row.country,
      region: row.region,
      venue: row.venue,
      vertical: row.vertical,
      audience: row.audience_size,
      audienceNum: Number(row.audience_size_num) || 0,
      audienceBasis: row.audience_size_basis,
      ratings,
      confidence: row.data_confidence,
      confidenceNote: row.data_confidence_note,
      sources: (row.source_urls || '').split(/\s;\s|;/).map((s) => s.trim()).filter(Boolean),
      score,
      tier: tierOf(score),
    });
  }
  return { conferences, warnings };
}
