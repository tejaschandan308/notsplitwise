# Build notes

## Working checklist (resumable)

- [x] Read AGENTS.md / CLAUDE.md, installed Next 16 docs (route handlers, testing, PWA, flash-before-hydration)
- [x] Baseline: lint (2 errors), tsc (pass), build (pass); before screenshots in `docs/screenshots/before`
- [x] Data model: payer, currency, revision/request token, field provenance; Dexie v2 migration
- [x] Shared parse-apply rule (atomic, token + revision + status + manual-field checks); capture + retry use it
- [x] Server parse: strict sanitising, positive amounts, payer/currency extraction, concise errors
- [x] Validation before Ready/export; honest custom split; export with payer + currency
- [x] Tests (vitest + fake-indexeddb, mocked model)
- [x] UI: tokens + shared components; setup, capture, inbox, review, export, nav, trip switcher
- [x] Checks: lint, tsc, build, tests; browser QA at 320/390/768/1440 x light/dark; after screenshots
- [x] README + final notes
- [x] Review follow-up (11 Oct 2026): payer evidence, capture-time currency,
      v1 participant protection, Review/export invalid states, `/dev` gated,
      regression tests (see "Review follow-up" below)
- [x] Release-review safety patch (11 Oct 2026): payer wording, amount
      separators and precision, navigation away from Review (see "Release-review
      patch" below)
- [x] Recovery-state fix (11 Oct 2026): a newer saved correction supersedes
      an older unsaved one (see "Recovery-state fix" at the end)

## Checks actually run (final state)

| Check | Baseline | Now (after the recovery-state fix) |
| --- | --- | --- |
| `npm run lint` | exit 1: 2 errors, 87 warnings (1 error + most warnings in generated `public/sw.js`, 1 `set-state-in-effect` error in inbox) | exit 0, no warnings |
| `npm run typecheck` | pass | pass |
| `npm test` | no tests | 9 files, 178 tests pass |
| `npm run build` | pass | pass (`/api/parse` is dynamic; the build makes no model calls) |
| `npm run test:e2e` | none | 17 Playwright tests pass against the production build; also 51/51 with `--repeat-each=3` |

The 75 browser QA checks described below are from the first pass and were
not repeated in either follow-up; their scripts lived outside the repo.

Tests were also checked for teeth: disabling the token / revision /
manual-field checks in `parse-lifecycle.ts` makes 5 tests fail.

Browser QA (production build, Chrome via Playwright, fresh isolated profile
per run, synthetic trips only; scripts kept outside the repo):

- 320, 390, 768, 1440 px in light and dark: setup by keyboard only, capture,
  save-before-AI, AI result shown, inbox state distinctions, ready selection,
  export content, copy to clipboard, Escape closes export and returns focus,
  review. 75/75 automated checks passed.
- No horizontal scrolling, no content hidden under fixed bars, all interactive
  targets ≥ 44px (except the visually hidden skip link), no console errors.
- Keyboard: trip switcher opens on Enter, focuses the current trip, arrow keys
  move, Escape returns focus; switching trips by keyboard works.
- In the real UI, a slow AI result (2.5 s) arriving after the amount and payer
  were edited kept both edits and filled only untouched fields.
- Offline: capture saves while offline ("Saved offline"), and is read
  automatically after reconnect.
- Migration in a real browser: a hand-built v1 database (IndexedDB version 10)
  opened by the new app upgraded to version 20; old Ready records kept their
  values and show "Assumed INR" / "Assumed you paid".
- Service worker enabled: registers, the capture screen reloads offline, and
  an offline save works. (With service workers blocked in QA, Serwist's
  registration helper logs `reading 'waiting'`; this does not occur with the
  worker enabled and is not app code.)

To guarantee no paid calls, the QA server ran with `ANTHROPIC_API_KEY` set to
empty and `/api/parse` responses were mocked in the browser.

## Credentials / blockers

- `.env.local` contains an `ANTHROPIC_API_KEY` entry. I did not read or use
  it, and **no live model call was made** in this work. Everything about the
  AI was verified with mocked model replies.
- Not verified: how well the real model follows the new prompt for payer
  ("Asha paid") and currency mentions. Server-side checks catch some wrong
  answers (a payer the text never states as paying, a contradicting payer,
  an invented currency) and turn them into review items. They cannot catch
  every semantic mistake: a wrong amount that is still a plausible number, or
  the wrong people sharing, passes validation. Extraction accuracy needs a
  live run with the key: `npm run dev`, then try captures on the Capture
  screen or `/dev` (development only).

## Product decisions

- **Save first, read later.** The draft is written in one IndexedDB write
  before any network call; capture never waits for the AI. The capture
  screen shows "Saved on this device" separately from the AI state.
- **Specific corrections instead of confidence.** The old "Double-check this
  one" banner relied on the model's own confidence. Review and the inbox now
  list concrete fixes ("Currency unclear: the capture says "$"", "Who paid?",
  "Who is "Dmitri"?") from one validation function (`src/lib/review.ts`) that
  also gates Ready in storage.
- **Payer is separate from sharing.** Default "Me" is labelled "Default" and
  applies only when the capture has no payment wording. A payer is accepted
  only when the text states a payment relationship (see "Review follow-up");
  an unknown payer gets "Add "Dmitri" to trip as payer", never an automatic
  participant slot.
- **Currency codes, not symbols.** Amounts render as "EUR 34.80". The trip has
  a default (set at creation, changeable from the trip menu for future
  captures). Totals appear per currency, never summed across currencies.
- **Custom split stays honest.** Labelled "Custom, enter later"; the export
  says shares are not calculated here.
- **Export is a reference, not an integration.** Stated in the dialog and in
  the text. Archive is offered on its own (before, it appeared only after a
  successful copy, so a failed copy hid it).
- **Design:** warm paper, ink, one bottle-green accent; semantic amber
  (needs review) and brick (failed). Tokens in `globals.css`, all text pairs
  ≥ 4.5:1 and field borders ≥ 3:1 in both themes (computed). Phones get a
  bottom nav and a pinned action bar that sits above the on-screen keyboard;
  from 768 px the nav moves into the top bar and actions sit inline. Desktop
  uses a fixed reading column rather than stretched inputs.
- **Removed row-level delete from the inbox.** Delete lives in Review behind a
  confirmation, which keeps the list scannable and reduces accidental loss.

## Review leads: what was found and done

| Lead | Finding in local code | Change |
| --- | --- | --- |
| `capture/page.tsx` background parse | Re-read the record but only protected the people lock; wrote all other fields unconditionally, including over manual edits, Ready or archived records | Replaced by `parseExpense` → `claimParse` / `applyParseResult` (token + revision + draft-only + manual fields, in one transaction) |
| `reparse.ts` retry | Applied results from an earlier snapshot with no checks; could run in parallel with the capture parse | Removed; retries go through the same rule, duplicate claims are refused, failed retries are capped at 3 automatic attempts |
| `review/[id]` edits during parse | Edits persisted while a parse could still overwrite them | Edits are recorded as manual (`editedFields`); late results skip them; review updates live without resetting a field being typed in |
| `types.ts` / `export.ts` | No payer or currency; export always printed ₹; a missing amount became ₹0 | Payer and currency fields with provenance; export prints code + amount + payer; missing amounts print "amount missing" |
| `parse-prompt.ts` | Assumed the user paid, stripped currency symbols, always equal split | Prompt asks for explicit payer and the currency as written; split is never inferred |
| `api/parse/route.ts` | Accepted zero/negative amounts, `Boolean()` coerced flags, returned raw provider errors to the client, trusted model confidence | Positive finite bounded amounts, strict booleans, bounded strings, mention-must-be-in-text checks, concise error codes with details logged server-side, confidence not used |
| Save / archive busy states | Archive had no error handling (busy state could stick); Ready had no failure path | All busy states release in `finally`; archive is one all-or-nothing transaction with a visible error; failed edits stay on screen with "Retry saving" |
| Already solved locally | Trip switcher, people lock at capture (`peopleLocked`), `capture-pills-fix.patch` (already applied in `f488d88`) | Preserved; the untracked patch file was left untouched |

## Remaining limits

- No live-model verification (see above).
- Archived expenses are not browsable in the UI (they remain stored).
- Trip members can be added but not renamed or removed.
- `/dev` is still in the codebase (it was marked temporary before this work)
  and calls the real parse API. It now renders only in development;
  production builds return 404 (covered by a browser test). Its client code
  is still compiled into the production bundle, though never rendered;
  delete it before release if that matters.
- Only five currencies; others (e.g. yen, A$) are flagged for review rather
  than supported.
- On iOS the keyboard-aware action bar relies on `visualViewport`; verified
  in desktop Chrome emulation, not on a physical device.
- Dev dependencies added: `vitest@4` (pinned below 5 to stay compatible with
  the project's `@types/node@20`) and `fake-indexeddb`. No framework
  upgrades. The follow-up added `@playwright/test`, pinned to exactly 1.61.0
  because that version matches the Chromium build already installed here
  (no browser download).

## Review follow-up (11 Oct 2026)

Addressed the reviewer's findings on the uncommitted work. The redesign,
data-safety architecture and unrelated work were kept. Nothing was
committed, pushed or deployed.

### 1. Payer inferred without evidence

Found: `sanitizePayer` accepted any model payer whose name occurred anywhere
in the text (substring match), so "1200 dinner with Asha and Ben" with the
model saying "Ben" stored Ben as payer with no review issue.
`mergeParsedFields` set a missing payer to Me even when the text said
"Asha paid".

Changed:
- `src/lib/payer.ts` (new): a small deterministic reader of explicit payment
  relationships ("X paid / covered / treated / bought…", "paid by X",
  "X's card", "my treat", "I paid"). Names match whole words,
  case-insensitively. Lists ("Asha and Ben paid") and several payers are
  flagged.
- `sanitizePayer`: with no payment wording, no payer is taken from the model
  and the labelled Me default applies. With payment wording, the model's
  payer is accepted only if it is the one person the text says paid.
  Missing, ambiguous, contradicting or multiple payers return
  `payerUnresolved: true` (a new field on the parse response).
- Capture, text correction and merge: a capture with payment wording starts
  with an open payer, which stays open until the payer is confirmed. The
  merge also checks the text itself, so a response from an older server
  can't default it to Me. Manual payer choices always win, as before.
- Review copy: "The capture mentions paying but doesn't clearly say who.
  Choose who paid." The "Add X to trip as payer" button is hidden when X is
  already a member.
- The currency-mention check (`mentionedInText`) also uses whole words now.

Limits: the reader knows a handful of English phrasings. Unusual phrasing
("Asha got this one") or a lower-case unknown name inside a list can still
be read wrongly or left open. (Lists after "paid by", negation and
repayments were then found to slip through; fixed in the release-review
patch below.) Ties go to leaving the payer open as a review item, but this does not
prove the model understood the sentence.

### 2. Currency context changed after capture

Found: `claimParse` sent the trip's current default, so a pending EUR
capture became USD after the trip default changed. `updateRawText` had the
same problem.

Changed: new `Expense.captureCurrency`, set from the trip default at
capture. The first parse, offline catch-up, retries and text corrections
all read the capture with it (`ParseTicket.defaultCurrency`; the request
field keeps its name, `tripCurrency`). Explicit currencies and manual
choices still win. A Dexie v3 upgrade stores the field without changing any
stored money:
- v1/legacy records get INR, the only currency the old app knew.
- Later records take their own stored currency. For a defaulted currency
  that is the default at capture; for an explicit or manual currency the
  context doesn't change the result.
- An unresolved bare `$` gets INR, which keeps it unresolved.

The trip's current default is never used to relabel existing expenses.

### 3. Legacy v1 participant edits not protected

Found: the old Review screen changed people without setting `peopleLocked`,
and `legacyEditedFields` didn't protect `included`, so a late parse replaced
a reduced list.

Changed:
- v1 drafts that are still pending or failed now keep their saved people,
  and any unresolved unknown names, when an AI result arrives. The old
  schema can't tell a deliberate "everyone" from the untouched default, so
  every such list is kept rather than guessing where it came from.
- Drafts already migrated by the earlier v2 build (still carrying a `legacy`
  payer or currency) get the same protection in the v3 upgrade.
- Ready and Archived records are unchanged.
- The merge no longer clears unknown names the person saved while people are
  fixed.

### 4. Review / export invalid states

Found (by inspection):
- Non-numeric amount text was dropped from the pending save, so Mark ready
  validated and readied the old amount.
- Mark ready only flushed pending text; it ignored earlier failed saves and
  saves still in flight.
- `saveManualEdit` let a Ready record become invalid and stay Ready.
- The Inbox selection and the export dialog trusted ids picked earlier.

Changed:
- Review tracks saves in flight and failed changes. Mark ready, and Done
  (now a button), refuse while the amount box holds non-numeric text: focus
  moves to the field, the text is kept, and "Amount isn't a number" appears
  in the fix list. Otherwise they write pending text, wait for every running
  save, and refuse if any change failed to save. The back link refuses on
  the same problems.
- `saveManualEdit`: an edit that leaves a Ready expense with review issues
  moves it back to Drafts in the same transaction. It must be marked ready
  again, and Review says "Moved back to Drafts".
- Inbox: the selection is filtered on every render to expenses that are
  Ready and valid, so edits in another tab drop them out.
- Export dialog: right before copying, it re-reads the selection from
  storage (`getExportableExpenses`). If anything differs, it copies nothing,
  shows the current text and says so. It also says how many expenses were
  left out, and has an empty state.

Limits at that point: leaving Review by the bottom navigation or the browser
back button with non-numeric amount text lost the typed text and left a
Ready expense exportable at its old amount. Fixed in the release-review
patch below.

### 5. `/dev`

`src/app/dev/page.tsx` is now a server component that calls `notFound()` in
production and otherwise renders the moved client code
(`src/app/dev/dev-tools.tsx`). `/api/parse`, manual mode and offline capture
are unchanged.

### Tests added

- `tests/payer.test.ts` (13 tests):
  - both reviewer examples and "I paid" variants
  - unknown and ambiguous payers, several candidate payers
  - names that only appear as participants
  - substring collisions ("Ana"/"banana", "Me"/"Mehul", "Ben"/"Benjamin")
  - capture-time default, text correction, manual choices winning
- `tests/currency-context.test.ts` (11 tests):
  - EUR to USD while offline, while a read is in flight, and before retrying
    a failed read
  - an explicit foreign currency
  - a bare `$` on EUR and USD trips
  - a manual currency across a default change, a retry and a text correction
  - v2 records without the field, and legacy INR records
- `tests/migration.test.ts` (5 more):
  - a true v1 to v3 migration of a pending draft with a hand-reduced people
    list (`peopleLocked: false`), then a late parse
  - a retry of a failed draft
  - an unknown name kept for review
  - an old Ready record left untouched
  - repair of drafts migrated by the earlier v2 build
- `tests/review-export.test.ts` (3 more):
  - clearing the amount on a Ready record moves it to Drafts and makes it
    non-exportable
  - a valid edit keeps it Ready
  - export re-validation ignores the stored status
- `e2e/review-safety.spec.ts` (7 Playwright tests). They run against the
  production build in a fresh profile with a synthetic trip, `/api/parse`
  mocked in the browser, and the server started with an empty
  `ANTHROPIC_API_KEY`:
  - change 1200 to "oops", then Mark ready
  - non-numeric amount text, then Done and the back link, on a Ready expense
  - a simulated IndexedDB write failure, then Mark ready, then Retry saving
  - clearing a Ready expense's amount
  - a selected Ready expense invalidated in a second tab before export
  - an expense invalidated by a raw write (no change notification) while the
    export dialog is open
  - `/dev` returns 404

How well the tests catch the bugs: undoing each fix on its own made the
matching tests fail:

| Fix undone | Failing tests |
| --- | --- |
| Claim uses the trip's current currency | 6 unit |
| Legacy people protection removed | 4 unit |
| Invalid Ready record stays Ready | 1 unit |
| Merge defaults to Me | 1 unit |
| Server accepts any named member | 7 unit |
| No whole-word match | 1 unit |
| Review guards and copy-time check removed together | 4 of 7 browser |

In the last case, the cross-tab test still passed because the storage rule
and the Inbox filter independently drop the invalidated expense.

Not done: no live model call, no physical iPhone keyboard test, and no new
screenshots. The visual design didn't change; Done is now a primary button
that looks like the old link.

## Release-review patch (11 Oct 2026)

A second review of `notsplitwise-review-v2.zip` held release for three
reproduced problems. This patch fixes them; the redesign and earlier fixes
are kept. Nothing was committed, pushed or deployed, and no paid API was
called.

### 1. Payer phrases that bypassed the evidence rule

Reproduced by the reviewer with a mocked model wrongly returning
`paidBy: "Asha"`, `paidByAmbiguous: false`: "paid by Asha and Ben", "paid by
Asha or Ben", "Asha paid me back" and "Asha paid nothing" were all accepted
and exportable. The "paid by" pattern matched the first name without looking
at what followed, and repayment or zero-payment sentences still contain
"Asha paid".

Changed (`src/lib/payer.ts`, `src/lib/parse-server.ts`):
- A list or choice after "paid by" ("paid by Asha and Ben", "paid by Ben or
  Asha") counts as several payers, so the payer stays unresolved.
- Repayment, negated and zero-payment wording ("paid me back", "repaid",
  "reimbursed", "owe", "settled up", "didn't pay", "has not paid", "never
  paid", "paid nothing / 0 / none") marks the evidence as doubtful, so the
  payer stays unresolved. This wording also counts as payment wording, so
  "1200 dinner, I owe Asha" no longer gets the Me default, and a capture
  using it starts with an open payer.
- Unchanged: "Asha paid", "paid by Asha", "paid by Asha for me and Ben", "I
  paid", "on Asha's card"; the labelled Me default without payment wording;
  whole-word matching; manual payer choices winning.

Limits: still a short list of English patterns, not language understanding.
There is no repayment ledger or multiple-payer support; such captures simply
ask the person who paid. A doubtful word anywhere in the note (for example
"not" right before "paid") leaves the payer open even when a correct single
payer is also stated. That is deliberate: it errs towards a review item.

### 2. Amount separators

Reproduced: `parseAmountInput("12,50")` removed every comma and returned
1250. A Ready EUR 12.50 edited to "12,50" stayed Ready at 1250.

Changed (`src/lib/currency.ts`): commas and spaces are no longer stripped
blindly. Accepted forms:
- dot decimal: 1240, 12.5, 12.50, 12. and .5
- decimal comma: exactly two digits after one comma (12,50 = 12.50), as on
  many European-language keyboards
- comma thousands groups: 1,240 and 12,345.50
- Indian lakh groups: 1,00,000 and 12,34,567.25

Everything else is refused with "Use a number above zero with up to two
decimals, like 1240, 1,240, 12.50 or 12,50.", including ambiguous forms
("1,2", "12,5", "1.200", "1.200,50", "1 200"), zero, negatives and amounts
above 100,000,000.

`isValidAmount` now enforces what its comment said: positive, finite, at
most `MAX_AMOUNT` (shared with the server sanitiser), and at most two
decimals. So storage validation, Ready, display and export agree. A stored
amount with more precision (which only a much older record or a direct write
could hold) now shows as "Amount invalid" and isn't exportable until fixed;
nothing is rounded silently.

### 3. Leaving Review lost invalid edits

Reproduced: on a Ready expense, typing "12o0" and then leaving by the bottom
navigation or browser Back kept it Ready at 1200, exported INR 1,200, and
reopening showed 1200. The text was never saved, and only the header link
and Done were guarded.

Changed:
- New `Expense.amountInput` (`src/lib/types.ts`, normalised to null for
  existing records; no schema upgrade needed). Amount text that isn't valid
  is saved straight away as `amountInput`, without the debounce. While it is
  set:
  - review validation reports "Amount not valid", quoting the text
  - a Ready expense moves back to Drafts in the same write
  - Mark ready and export refuse it
  - a late AI result can't overwrite the amount
  - Review shows the text again on every visit
- A valid amount clears `amountInput`. "Discard "12o0", keep INR 1,200"
  clears it explicitly and keeps the previous amount. Either way the expense
  stays in Drafts and must be marked ready again.
- New write-ahead copy (`src/lib/unsaved-edits.ts`, localStorage, this
  device only): each manual edit is recorded before it is saved. It is
  removed once IndexedDB confirms that exact value, so a newer edit still
  in flight is kept. If a save fails, or the page is left or closed before
  it finishes:
  - Review offers "A change from earlier wasn't saved" with Save it now or
    Discard it; Done, Mark ready and the header link refuse until one is
    chosen
  - the Inbox marks the row "Unsaved change on this device" and won't select
    it
  - the export dialog's copy-time check leaves it out
  - entries that already match storage are ignored, and in-session save
    failures also offer "Discard change"
- The header link and Done still refuse on known problems. The bottom
  navigation and browser Back can't be intercepted reliably, so they rely on
  the persisted state above rather than a prompt.
- Copy: "copy a clean list into Splitwise" became "copy a reference for
  manual entry in Splitwise" (metadata) and "copy a reference for entering
  them in Splitwise" (trip setup).

Limits:
- The write-ahead copy is per browser profile. If localStorage is blocked
  and IndexedDB also fails, a failed edit is still shown on screen (as
  before) but can't survive leaving the page.
- If the page is closed in the instant between the IndexedDB commit and
  removing the write-ahead entry, the entry stays but matches storage, so it
  is ignored.
- The header-link guard does not wait for saves still in flight. A save
  that later fails is caught by the write-ahead copy instead.

### Tests added or changed

- `tests/payer.test.ts` (+18):
  - the four reproduced phrases, plus "paid by Ben and Asha", "didn't pay",
    "has not paid yet", "paid 0", "I owe Asha" and "reimbursed me": each
    sanitised, applied and checked for a review issue
  - ordinary wording controls
  - the Me default without payment wording
  - an open payer at capture
  - a manual payer winning over doubtful wording
- `tests/amount-input.test.ts` (new, 43):
  - accepted and refused forms, including "12,50" never becoming 1250
  - precision and limit rules
  - `amountInput` on a Ready record: moved to Drafts, an issue, not
    exportable, Mark ready refused
  - correction needing an explicit Mark ready
  - discard keeping the old amount
  - a late AI result not overwriting it
  - a decimal-comma edit exported as EUR 12.50
  - the write-ahead copy: forgetting only matching values, ignoring entries
    that match storage, tolerating a broken localStorage
- `e2e/navigation-safety.spec.ts` (new, 7 browser tests):
  - Ready, then "12o0", then bottom navigation, then export (not exported;
    Drafts shows the issue), then reopen showing "12o0", correct to 1250,
    Mark ready, export INR 1,250
  - in-app browser Back, then "12o0" kept, then Discard keeping INR 1,200,
    then Mark ready required
  - browser Back immediately after typing, across a full page load: never
    exportable, and the text is recoverable
  - a simulated IndexedDB write failure, then bottom navigation: the row is
    marked unsaved and not selectable, and is left out of export; on the
    next visit Done refuses, Save it now stores 1300, export shows INR 1,300
  - a failed save explicitly discarded
  - "12,50" stays 12.50 through Done and export; "1,2" is refused, kept and
    moves the expense to Drafts
  - ordinary "1,240" and "1240.5" controls
- `e2e/review-safety.spec.ts`: expectations updated. Invalid text is now
  stored as `amountInput` and the expense moves to Drafts immediately, so
  that test accepts either Done or Mark ready as the refusing button. The
  messages are now "The amount isn't valid yet" and "A change didn't save".

How well the tests catch the bugs: undoing each fix on its own made tests
fail:

| Fix undone | Failing tests |
| --- | --- |
| No list check after "paid by" | 2 unit |
| Doubtful wording ignored | 3 unit |
| Old separator stripping | 11 unit |
| No two-decimal rule | 1 unit |
| `amountInput` not a review issue | 3 unit |
| Invalid text not saved + write-ahead copy disabled (together) | 7 of 14 browser |

Not done in this patch:
- live-model extraction
- a physical iPhone/Safari pass
- the earlier 75-check viewport/theme matrix
- service-worker/offline behaviour (browser tests block service workers)
- a real-browser legacy database migration
- new screenshots (the visual design is unchanged; the new notices reuse the
  existing Notice and Button styles)

## Recovery-state fix (11 Oct 2026)

A review of `notsplitwise-review-v3.zip` reproduced one release blocker in
save recovery:
1. Ready 1200; a 1300 edit fails to save.
2. Leave, then reopen Review.
3. Save 1400 successfully.
4. "A change from earlier wasn't saved" is still offered. "Save it now"
   writes 1300 over 1400, and the expense stays Ready and exports INR 1,300.

Cause: `earlier` in `src/app/review/[id]/page.tsx` was a snapshot of the
recovery values taken when Review opened. Later saves never reconciled it,
and "Save it now" submitted the snapshot.

Changed:
- Review keeps only the *field names* that had an unsaved change from an
  earlier visit. Any edit made in this visit removes its fields from that
  set, so a newer edit supersedes the older one for the same field. That
  happens whether the newer edit's save succeeds or fails; a failure is
  handled by the in-visit "Your last change didn't save" notice.
- The values offered are recomputed from the current write-ahead copy and
  storage on every render, and again when "Save it now" is clicked. Only
  fields still unresolved are saved. The notice disappears, and Done / Mark
  ready work normally, once nothing is left to recover.
- `src/lib/unsaved-edits.ts`: the amount and its unfinished text
  (`amountInput`) are one field. Remembering either replaces any older value
  of the other, so an older `amountInput` can't reappear over a newer valid
  amount, or the other way round, even across reloads.
- Discarding is narrower. "Discard change" (a failed save in this visit) and
  "Discard it" (an earlier visit) remove only those values from the
  write-ahead copy. Before, both cleared every remembered change for the
  expense, including newer pending edits.
- Unchanged: the failed-save, discard, invalid-text, navigation and export
  protections. Inbox and export still exclude any expense whose write-ahead
  copy differs from storage.

Tests:
- `e2e/recovery-safety.spec.ts` (new, 3 browser tests, same mocked and
  empty-key setup as the other browser tests):
  1. Ready 1200, failed 1300, leave and reopen, save 1400: no recovery
     offered, including after a reload; Done and export use INR 1,400 and
     never 1,300.
  2. Recovery holds an amount and a description. After correcting the
     amount to 1400, only the description is offered and Done refuses until
     it is resolved; "Save it now" stores the description, and the amount
     stays 1400 through Done and export.
  3. A newer 1400 correction that also fails: Done refuses, the stored 1200
     row is marked unsaved and can't be selected, and once storage works
     again the recovery offers 1400 (not 1300); exports INR 1,400.
- `tests/amount-input.test.ts` (+1): the amount group rule in the
  write-ahead copy.

How well the tests catch the bug: putting back the snapshot behaviour (cached
values at open, "Save it now" submitting the snapshot) made all 3 new
browser tests fail.

Not covered here, as before: live-model accuracy, a physical iPhone/Safari
pass, the earlier 75-check viewport/theme matrix, service-worker/offline
behaviour, and migrating a real existing browser database.
