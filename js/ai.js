// Client side of the AI relationship read. The key never reaches the browser: we call our own endpoint.
// Everything here is defensive: the read is optional, and any failure shows "AI read unavailable".

export function signature(contact, encounters, rule) {
  return JSON.stringify([
    contact.company, contact.override?.state || null, rule.state,
    encounters.map((e) => [e.id, e.outcome, e.nextStep?.status || null, (e.note || '').length]),
  ]);
}

export function buildPayload({ contact, encounters, rule, eff, confName, repName, today }) {
  return {
    today,
    contact: {
      firstName: contact.name.split(/\s+/)[0],
      company: contact.company,
      title: contact.title || '',
      previousCompanies: (contact.history || []).map((h) => ({ company: h.company, title: h.title || '', until: h.until || '' })),
    },
    state: {
      label: rule.state,
      reasons: rule.reasons,
      override: eff.source === 'override' ? { state: eff.state, reason: eff.override.reason } : null,
    },
    encounters: encounters.map((e) => ({
      id: e.id,
      date: e.date,
      conference: confName(e),
      rep: repName(e.rep),
      company: e.company || contact.company,
      outcome: e.outcome,
      nextStep: e.nextStep ? { text: e.nextStep.text, status: e.nextStep.status, due: e.nextStep.due || '' } : null,
      note: e.note || '',
    })),
  };
}

// Deterministic guard: keep only evidence that cites an encounter this contact actually has.
export function validateRead(data, encounterIds) {
  if (!data || typeof data.summary !== 'string' || !data.summary.trim()) return null;
  const ids = new Set(encounterIds);
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];
  const kept = evidence.filter((x) => x && ids.has(x.encounterId) && typeof x.point === 'string').slice(0, 3);
  return {
    summary: data.summary.trim(),
    evidence: kept,
    droppedEvidence: evidence.length - kept.length,
    suggestedAction: typeof data.suggestedAction === 'string' ? data.suggestedAction.trim() : '',
    disagreement: data.disagreement && data.disagreement.flag ? String(data.disagreement.note || '').trim() : '',
    notEnoughInfo: !!data.notEnoughInfo,
    model: data.model || '',
    elapsedMs: data.elapsedMs || 0,
  };
}

export async function requestRead(payload, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('api/relationship-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body.error || `HTTP ${r.status}` };
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timed out' : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}
