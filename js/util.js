// Small shared helpers. Dates are plain "YYYY-MM-DD" strings everywhere, so comparisons are simple string compares.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toUTC(d) {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s));
}

// Whole days from a to b (positive if b is later).
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function addDays(d, n) {
  return new Date(toUTC(d) + n * 86400000).toISOString().slice(0, 10);
}

// Calendar months, clamped to the month's last day (e.g. 31 Aug + 6 months = 28 Feb).
export function addMonths(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export function todayReal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

export function fmtDay(d) {
  if (!d) return '';
  const [, m, day] = d.split('-').map(Number);
  return `${DAYS[new Date(toUTC(d)).getUTCDay()]} ${day} ${MONTHS[m - 1]}`;
}

export function fmtRange(a, b) {
  if (!a) return 'Dates TBC';
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = (b || a).split('-').map(Number);
  if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[ma - 1]} ${ya}`;
  if (ya === yb) return `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]} ${ya}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function monthLabel(d) {
  const [y, m] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
