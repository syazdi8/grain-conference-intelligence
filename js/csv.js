// Minimal CSV reader/writer (RFC 4180 style): quoted fields may contain commas, quotes ("") and line breaks.

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, ''); // strip Excel's byte-order mark
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

// Rows of objects keyed by the header row.
export function parseCSVObjects(text) {
  const [header, ...rows] = parseCSV(text);
  return rows.map((r, i) => {
    const o = { _line: i + 2 }; // line number as seen in Excel (header is line 1)
    header.forEach((h, j) => { o[h.trim()] = (r[j] ?? '').trim(); });
    return o;
  });
}

function quote(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}
