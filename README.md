# Log now, split later

A small travel-expense notebook for group trips. On the trip you jot an
expense in a few seconds ("1240 lunch, Asha paid, me + Ben"). Later you check
what the app read, fix anything unclear, and copy a tidy list to enter by hand
in Splitwise.

It is deliberately not a Splitwise replacement: no accounts, no settlement
maths, no sync, no automatic Splitwise integration.

## The flow

1. **Start a trip.** Name it, add the people (you are always "Me"), and pick
   the usual currency (INR, USD, EUR, GBP or AED).
2. **Capture.** Type or use your phone keyboard's dictation. Optionally tap who
   shared it and who paid. Saving writes the expense to the device
   immediately, before any network call.
3. **Inbox.** Drafts show a clear state: *Reading…*, *Saved offline*,
   *Couldn't read* (with Retry / Fill in by hand), *Needs review* (with the
   exact things to fix) or *Check & mark ready*.
4. **Review.** Your original text stays visible and correctable. Confirm the
   amount, currency, payer, people and split, then mark it Ready. Ready is
   blocked until the amount is a positive number, currency and payer are
   resolved, everyone sharing is a trip member and unknown names are handled.
   Amounts accept 1240, 12.50, a decimal comma (12,50), and 1,240 or
   1,00,000 grouping, with up to two decimals. Anything ambiguous ("1,2",
   "1.200") is refused with guidance, never guessed. Amount text that isn't
   valid is saved with the expense as unresolved, so leaving Review by any
   route (header link, bottom navigation, browser Back) keeps it for
   correction and moves a Ready expense back to Drafts; it can also be
   explicitly discarded. Each edit is also kept in a small on-device copy
   until storage confirms it, so a failed or interrupted save is offered again
   (save or discard) and keeps that expense out of export. A newer edit to
   the same field replaces the older unsaved one, so recovery never writes an
   older value over a newer correction. After a fix, the expense must be
   marked ready again.
5. **Export.** Select Ready expenses and copy a plain-text reference (amount
   with currency code, payer, description, people, split). The selection is
   re-checked against storage when copying; anything changed or no longer
   valid is left out. Then choose explicitly to archive them or keep them in
   Ready.

## Local-data architecture

- **Storage:** IndexedDB via Dexie, database `log-now-split-later` (name kept
  from v1 so existing data is untouched). Tables: `trips`, `expenses`,
  `parseStats`.
- **Migration:** schema v2 (`src/lib/db.ts`) adds payer, currency, capture
  revision and field provenance. Existing records keep every value; old
  records are marked `legacy` so the UI says "Assumed INR" / "Assumed you
  paid" instead of claiming information that was never stored.
  Schema v3 stores each expense's capture-time default currency
  (`captureCurrency`) and protects the saved people on old unfinished v1
  drafts from a later AI result. `src/lib/normalize.ts` also normalises every
  read defensively.
- **Offline:** the app is a PWA (Serwist). Captures always save locally.
  Drafts waiting for the AI are retried on load, reconnect and window focus
  (`src/lib/parse-client.ts`), with a cap on automatic retries.
- **Nothing leaves the device** except the capture text sent to `/api/parse`.
  There is no backend database.

## The AI's bounded role

The AI only *suggests* fields for a draft that is already saved. It never
decides whether something is valid.

- `/api/parse` (`src/lib/parse-server.ts`) validates and bounds input, calls
  the model, and sanitises output: amounts must be positive and finite,
  booleans must be real booleans, names must match trip members (whole
  words, not substrings), and a currency the text doesn't contain is
  discarded.
- **Currency** is read deterministically by the app (`src/lib/currency.ts`)
  and that reading wins over the model. A bare `$` is USD only on a USD trip;
  otherwise it is flagged for review. Every reading of an expense (first
  parse, offline catch-up, retries, text corrections) uses the trip default
  from when it was captured, so changing the trip default affects future
  captures only. No currency conversion, and totals are only ever shown per
  currency.
- **Payer** is only accepted when the text states a payment relationship
  ("Asha paid", "paid by Asha", "I paid", "on Asha's card"); a name that is
  only in the list of people sharing is not enough. If the text talks about
  paying but the reading is missing, contradicts it, is ambiguous or names
  several people ("paid by Asha and Ben"), or uses repayment, negated or
  zero-payment wording ("Asha paid me back", "Asha paid nothing", "I owe
  Asha"), the payer stays unresolved for review instead of defaulting to Me. A note with no payment wording gets the labelled "Me" default. A
  payer chosen by hand always wins. These checks catch unsupported or
  contradictory payers; they don't understand every phrasing, so the Review
  screen remains the place where the person confirms it.
- **One rule for applying results** (`src/lib/parse-lifecycle.ts`): each
  request gets a token for the current capture revision. A result is written
  only if, inside the same IndexedDB transaction, the expense still exists, is
  still a draft, has the same capture text revision and still holds that
  token. Fields edited by hand are never overwritten. Initial parse and
  retries use the same path, and a second request for the same revision is
  refused while one is in flight.
- Provider errors are logged server-side; the browser only receives a short
  error code. The API key stays on the server.

## Setup

Requires Node 20+.

```bash
npm install
# create .env.local (see below)
npm run dev                  # http://localhost:3000
```

`.env.local`:

```
ANTHROPIC_API_KEY=...        # required for AI reading; without it captures
                             # still save and can be completed by hand
ANTHROPIC_MODEL=...          # optional, defaults to claude-sonnet-4-6
```

Without a key the app works fully in manual mode: drafts show "AI reading
isn't set up on this server" and can be filled in by hand.

## Checks

```bash
npm run lint        # ESLint (source only; the generated service worker is ignored)
npm run typecheck   # tsc --noEmit
npm test            # Vitest: data-safety tests with a fake IndexedDB and mocked model replies
npm run build       # production build (webpack, needed for Serwist)
npm run test:e2e    # Playwright against the production build (run build first)
```

The tests focus on behaviour that could lose or misrepresent money:
local save under AI failure and offline, slow results after manual edits /
Ready / archive / delete, initial-parse vs retry races, people and payer
locks, known vs unknown vs ambiguous payers, explicit and ambiguous
currencies and the capture-time currency default, invalid amounts,
unresolved names, amount separators and precision, the v1 / v2 to v3
migrations, and the export text. The browser tests cover invalid amount text
and failed saves on Review, leaving Review by the header link, bottom
navigation and browser Back, decimal-comma input, and expenses invalidated in
another tab before export. No test calls a real
model: unit tests mock the model, and browser tests mock `/api/parse` and
run the server with an empty `ANTHROPIC_API_KEY`.

`/dev` is a temporary developer page from earlier work (it calls the real
parse API). It only renders in development; production builds return 404.

## Project layout

```
src/app/            screens: trip/new, capture, inbox, review/[id], api/parse
src/components/     shared UI: button, field, chip, member-pill, status-badge,
                    money, dialog, export-dialog, top-bar
src/lib/            data and rules: db, storage, normalize, parse-*, currency,
                    review (validation), export, expense-state, hooks
tests/              Vitest suites
e2e/                Playwright browser tests (mocked parse, synthetic data)
docs/screenshots/   before/after screenshots (synthetic data)
```
