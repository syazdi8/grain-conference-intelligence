// The workspace: everything a user changes lives in this browser only (a per-browser sandbox).
// Reference data (data/conferences.csv) and the seed (data/seed.json) come from the repo.
import { loadConferences } from './scoring.js';

const KEY = 'grain-conference-intel:workspace';

export async function loadStatic() {
  const [csv, seed] = await Promise.all([
    fetch('data/conferences.csv', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('conferences.csv not found'); return r.text(); }),
    fetch('data/seed.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('seed.json not found'); return r.json(); }),
  ]);
  return { ...loadConferences(csv), seed };
}

export function freshWorkspace(seed) {
  const copy = JSON.parse(JSON.stringify(seed));
  return {
    seedVersion: seed.version,
    currentUser: seed.defaultUser,
    owners: copy.owners,
    contacts: copy.contacts,
    encounters: copy.encounters,
    aiCache: {},
  };
}

// Returns { ws, notice }. A new seed version triggers an offer to reset rather than silently mixing data.
// `storage` is only for tests. The browser's localStorage is looked up inside the try, because in a browser
// that blocks storage even reading the localStorage property throws.
export function loadWorkspace(seed, storage) {
  let raw = null;
  try { raw = (storage ?? globalThis.localStorage).getItem(KEY); } catch { return { ws: freshWorkspace(seed), notice: 'storage' }; }
  if (!raw) return { ws: freshWorkspace(seed), notice: null };
  try {
    const ws = JSON.parse(raw);
    delete ws.useRealDate; // left by the retired real-date toggle; ignored so no browser stays off the demo date
    if (ws.seedVersion !== seed.version) return { ws, notice: 'seed-changed' };
    return { ws, notice: null };
  } catch {
    return { ws: freshWorkspace(seed), notice: null };
  }
}

export function saveWorkspace(ws) {
  try { localStorage.setItem(KEY, JSON.stringify(ws)); return true; } catch { return false; }
}

export function clearWorkspace() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable: nothing to clear */ }
}

// The prototype always runs on the fixed demo date in the seed, so the demo is reproducible.
// A production version would use today's date.
export function today(seed) {
  return seed.demoDate;
}
