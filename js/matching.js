// Deterministic contact matching (PRODUCT_DECISIONS §9). No AI: it must be predictable and explainable.
// Only a same-email match links automatically; everything else is a suggestion the rep confirms.

const NICKNAMES = [
  ['alex', 'alexander', 'alexandra', 'sasha'], ['dan', 'danny', 'daniel'], ['dave', 'david'], ['tom', 'thomas', 'tommy'],
  ['chris', 'christopher', 'christine', 'christina'], ['mike', 'michael'], ['kate', 'katie', 'katherine', 'catherine'],
  ['liz', 'beth', 'elizabeth'], ['bob', 'rob', 'robert'], ['bill', 'will', 'william'], ['jim', 'james'], ['jon', 'jonathan'],
  ['sam', 'samuel', 'samantha'], ['ben', 'benjamin'], ['nick', 'nicholas'], ['andy', 'andrew'], ['matt', 'matthew'],
  ['joe', 'joseph'], ['tony', 'anthony'], ['steve', 'stephen', 'steven'], ['pete', 'peter'], ['rick', 'rich', 'richard'],
  ['jen', 'jenny', 'jennifer'], ['ed', 'eddie', 'edward'], ['greg', 'gregory'], ['josh', 'joshua'], ['vicky', 'victoria'],
];
const NICK = new Map();
NICKNAMES.forEach((group, i) => group.forEach((n) => NICK.set(n, i)));

// Team inboxes don't identify a person, so they never produce a Certain match (or a HubSpot email).
export const SHARED_INBOXES = new Set(['info', 'sales', 'contact', 'hello', 'payments', 'finance', 'accounts', 'admin', 'support',
  'team', 'office', 'billing', 'partnerships', 'treasury', 'enquiries', 'inquiries', 'marketing', 'ops', 'operations', 'noreply']);
const FREE_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);
const LEGAL_SUFFIXES = new Set(['ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'gmbh', 'ag', 'sa', 'sl', 'sas', 'bv', 'nv', 'srl', 'spa', 'corp', 'corporation', 'co', 'company', 'pte', 'pty', 'oy', 'ab', 'as', 'kg']);

export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function nameTokens(name) {
  return fold(name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function normCompany(company) {
  return fold(company).replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t && !LEGAL_SUFFIXES.has(t));
}

export function sameCompany(a, b) {
  const x = normCompany(a);
  const y = normCompany(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  // "Quellan" vs "Quellan Payments": the shorter name is the start of the longer one.
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s[0].length >= 4 && s.every((t, i) => l[i] === t);
}

export function emailInfo(email) {
  const e = String(email ?? '').trim().toLowerCase();
  const m = e.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!m) return null;
  return { email: e, local: m[1], domain: m[2], shared: SHARED_INBOXES.has(m[1]), free: FREE_DOMAINS.has(m[2]) };
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function parts(name) {
  const t = nameTokens(name);
  return { first: t[0] || '', last: t.length > 1 ? t[t.length - 1] : '' };
}

export function sameName(a, b) {
  const x = parts(a);
  const y = parts(b);
  if (!x.first || !x.last || !y.first || !y.last) return false;
  return (x.first === y.first && x.last === y.last) || (x.first === y.last && x.last === y.first); // swapped order
}

function firstNameVariant(a, b) {
  if (a === b) return false;
  if (NICK.has(a) && NICK.get(a) === NICK.get(b)) return 'nickname';
  if ((a.length === 1 && b[0] === a) || (b.length === 1 && a[0] === b)) return 'initial';
  if (a.length > 2 && b.length > 2 && lev(a, b) === 1) return 'one-letter difference';
  return false;
}

// Returns the kind of variation, or false.
export function similarName(a, b) {
  if (sameName(a, b)) return false;
  const x = parts(a);
  const y = parts(b);
  if (!x.first || !x.last || !y.first || !y.last) return false;
  if (x.last === y.last) return firstNameVariant(x.first, y.first);
  if (x.first === y.first && x.last.length > 3 && lev(x.last, y.last) === 1) return 'one-letter difference';
  return false;
}

export const LEVELS = {
  certain: { order: 0, label: 'Certain', auto: true },
  strong: { order: 1, label: 'Strong', preselect: true },
  variation: { order: 2, label: 'Possible: name variation' },
  jobChange: { order: 3, label: 'Possible: job change' },
  nameOnly: { order: 4, label: 'Same name' }, // company not typed yet: a hint, not a match
};

function companiesOf(contact) {
  return [contact.company, ...(contact.history || []).map((h) => h.company)].filter(Boolean);
}
function emailsOf(contact) {
  return [contact.email, ...(contact.history || []).map((h) => h.email)].filter(Boolean).map((e) => e.toLowerCase());
}

// Compares a capture-in-progress against every known contact. Returns suggestions, best first.
export function findMatches(input, contacts) {
  const name = input.name || '';
  const company = (input.company || '').trim();
  const mail = emailInfo(input.email);
  if (nameTokens(name).length < 2 && !mail) return [];
  const out = [];
  for (const c of contacts) {
    if (mail && !mail.shared && emailsOf(c).includes(mail.email)) {
      out.push({ contact: c, level: 'certain', why: 'Same email' });
      continue;
    }
    const nameSame = sameName(name, c.name);
    const variant = nameSame ? false : similarName(name, c.name);
    const cmpSame = !!company && companiesOf(c).some((x) => sameCompany(company, x));
    const cEmail = emailInfo(c.email);
    const domainSame = !!mail && !mail.free && !!cEmail && !cEmail.free && mail.domain === cEmail.domain;
    if (nameSame && (cmpSame || domainSame)) {
      const prevCo = cmpSame && !sameCompany(company, c.company);
      out.push({ contact: c, level: 'strong', why: cmpSame ? (prevCo ? 'Same name + their previous company' : 'Same name + same company') : 'Same name + same email domain' });
    } else if (variant && (cmpSame || domainSame)) {
      out.push({ contact: c, level: 'variation', why: `Similar name (${variant}) + same company` });
    } else if (nameSame && company) {
      out.push({ contact: c, level: 'jobChange', why: `Same name, different company (was ${c.company})` });
    } else if (nameSame && !company) {
      out.push({ contact: c, level: 'nameOnly', why: 'Same name: add the company to check' });
    }
    // A similar name with nothing else shared → no suggestion (avoids noise).
  }
  return out.sort((a, b) => LEVELS[a.level].order - LEVELS[b.level].order || a.contact.name.localeCompare(b.contact.name));
}
