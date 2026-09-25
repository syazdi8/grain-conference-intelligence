# Conference Intelligence: prototype for Grain's sales team

This tool helps the sales team:
- choose conferences by ICP fit;
- see coverage for the next 12 months: unowned high-fit events, trip clusters, and sample coverage assignments;
- capture people on the show floor in seconds;
- recognise repeat encounters across conferences, with an evidence-backed read of each relationship;
- hand contacts to HubSpot.

**Everything in the sample data is fictional:** team, people and companies. Emails use the reserved `.example` domain. Conference data is public and sourced; see the `source_urls` column.

## What's in the box

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `js/` | The app: plain HTML/CSS/JavaScript, no framework, no build step |
| `js/scoring.js` | ICP fit: four 0–3 ratings, weights 35/30/25/10, tiers A ≥ 75 / B 55–74 / C < 55 |
| `js/planning.js` | Coverage flags: unowned A-tier events; A/B events in the same city within 14 days ("Trip cluster": travel that could plausibly be combined, a signal for the sales lead, not a recommendation); 3+ A/B events starting within 3 weeks of each other, wherever they are ("Busy stretch": concentrated coverage demand). Which contacts we met at past editions of each event ("Relationships from past editions" on the conference page: where those relationships stand today, not an attendee list or pipeline). Also which conferences Capture offers: only those happening on the app date, so an encounter is never logged against an event that hasn't happened (logging after an event is future work) |
| `js/matching.js` | Deterministic contact matching: same email → linked; same name + company → strong; nickname/initial/typo → possible; same name + new company → "same person, new company?" |
| `js/relationship.js` | Relationship state from rules (Warming / Stalled / Low intent / Early) and the nudge sized to it |
| `js/exporter.js` | The HubSpot-ready CSV |
| `api/relationship-read.js` | The one serverless function. It calls Claude for the AI relationship read, and it is the only code that sees the API key |
| `data/conferences.csv` | The conference list (13 researched events). Edit it in Excel or Google Sheets |
| `data/seed.json` | The sample team, contacts and encounters. The demo date is fixed at Mon 19 Oct 2026 |
| `tests/` | Logic and API tests (`npm test`) |

## Where data lives

- **Conferences and the seed** come from the files above.
- **Everything you change** (captures, owners, overrides, next-step status, exports, AI reads) is saved in **your browser only**. It's a per-browser sandbox, so reviewers never see each other's changes.
- **Reset demo data** (at the bottom of every page) restores the seed.
- **The app runs on a fixed demo date** (Mon 19 Oct 2026, `demoDate` in the seed) so the demo is reproducible; the conference list is a researched sample, not a live feed. Production would use today's date.
- In production this would be a shared database behind a login.

## Run it locally

You need Node 20.11 or newer.

```
npm run dev        # serves the app at http://localhost:3000
npm test           # runs the logic and API tests
```

- Without a key, everything works except the AI read, which shows "AI read unavailable".
- To try the AI read locally, set `ANTHROPIC_API_KEY` in your own terminal's environment before `npm run dev`.
- **Never put the key in a file in this repo.**

## Deploy (Vercel)

1. Import this GitHub repo into Vercel. There's no framework and no build command, and the defaults work.
2. In **Project → Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY`: from a dedicated Anthropic Console workspace with a spend limit;
   - optionally, `ANTHROPIC_MODEL` (default `claude-sonnet-5`).
3. Redeploy. Every push to GitHub redeploys automatically.

## Update the conference list (no code)

1. Open `data/conferences.csv` in Excel or Google Sheets. Add or edit a row: dates as `YYYY-MM-DD`, ratings 0–3, one evidence line per rating.
2. Save it as CSV.
3. On GitHub, open the `data` folder, choose **Add file → Upload files**, upload it, and **Commit**.
4. Vercel redeploys, and scores and tiers recompute.

A bad row (for example a rating of 4, or a missing date) is skipped and listed as a warning on the Conferences page. It doesn't break the app.

## How the AI read is kept honest

- It receives only this contact's confirmed encounters, the rules' state and reasons, and the reps' notes. It gets no email addresses.
- It must cite encounter ids. The app **drops any evidence that cites an encounter the contact doesn't have**.
- The rules set the state label; the AI can only flag that the notes disagree. The rep can override the state with a reason.
- Structured output (a JSON schema) keeps the reply in a fixed shape. Notes are treated as data, never as instructions.
- If anything fails (no key, spend limit reached, timeout, bad reply), the profile says "AI read unavailable". Capture, matching and export never depend on AI.
