// HubSpot-ready CSV (PRODUCT_DECISIONS §13, D13). One contact per row, header row, mapped at import.
import { toCSV } from './csv.js';
import { emailInfo } from './matching.js';

export const HUBSPOT_COLUMNS = [
  'First Name', 'Last Name', 'Email', 'Company Name', 'Job Title',
  'Latest Conference', 'Latest Conference Date', 'Conferences Met At',
  'Relationship State', 'State Basis', 'Suggested Next Action', 'Short Summary', 'Grain Rep',
];

export function splitName(name) {
  const t = String(name).trim().split(/\s+/);
  return { first: t[0] || '', last: t.slice(1).join(' ') };
}

// Email that is safe to hand to HubSpot, which uses email to recognise contacts.
// Shared inboxes would merge different people; an old company's email moves to history (C9) and isn't here.
export function exportableEmail(contact) {
  const info = emailInfo(contact.email);
  if (!info || info.shared) return '';
  return info.email;
}

export function exportWarnings(contact) {
  const w = [];
  const info = emailInfo(contact.email);
  if (info?.shared) w.push(`${contact.name}: ${contact.email} is a shared inbox, so it's left out (it would merge people in HubSpot)`);
  else if (!info) {
    const old = (contact.history || []).find((h) => h.email);
    w.push(old
      ? `${contact.name}: no current email (last known at ${old.company}, not exported)`
      : `${contact.name}: no email. HubSpot may not match this contact to an existing record`);
  }
  return w;
}

// rows: [{ contact, latestConference, latestDate, conferencesMetAt, state, stateBasis, action, summary, rep }]
export function buildHubspotCsv(rows) {
  const data = rows.map((r) => {
    const n = splitName(r.contact.name);
    return [n.first, n.last, exportableEmail(r.contact), r.contact.company, r.contact.title || '',
      r.latestConference, r.latestDate, r.conferencesMetAt, r.state, r.stateBasis, r.action, r.summary, r.rep];
  });
  return toCSV([HUBSPOT_COLUMNS, ...data]);
}
