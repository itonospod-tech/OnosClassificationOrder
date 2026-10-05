# Tool-check redesign — proposal

Status: Phase 1 APPROVED 05/10/2026 and implemented (kanban "Soát tool" target behind the per-factory flag `allowToolCheckRework`, default OFF; corrected hint text; Telegram "Hold Support" line). Phase 2 waits for the measurement. Data: dev DB, read-only, snapshot 05/10/2026 (orders to 04/10, orderLogs to 03/10). Monthly figures come from `fulfillmentTimeline[].at`, not `updatedAt`.

> **Scope of the experiment (read first):** "enable at In Mê Linh" really means enabling it for the **Print stage of that factory only**. QC-after-press Thái Nguyên (45 of the 286 historical send-backs), QC-after-press Mê Linh (37) and In Thái Nguyên (33) still have no route to Support. The first run covers roughly **150 of 286 (~52%)** of the historical volume. It is a signal, not a full test.

## 0. The number the owner most needs

**Sending an order back through Support is 6–8x slower than sending it to the designer.**
Time from the send-back to the next human event on the order, Jul–Aug:

| Send-back target | n | median | p75 | p90 |
|---|---|---|---|---|
| Support (tool-check) | 282 | **11.7 h** | 30 h | 71 h |
| Designer | 1,149 | **1.9 h** (Sep: 1.4 h) | 5.6 h | 24 h |

(10% of tool-check send-backs never get a next human event.) This holds whether or not we redesign anything.

## 1. What we found

- **Volume fell:** workers sent 225 (Jul) → 57 (Aug) → 4 (Sep) → 0 (Oct) orders to Support. Meanwhile send-backs to designer rose 487 → 662 → 1,006.
- **`skipToolCheck` is NOT the cause:** the MLDTF factory has 0 send-backs to tool-check ever; the drop began in August, before the flag (18/09).
- **The same people switched.** The 286 send-backs came from 4 station accounts (one account per factory x stage): In Mê Linh 150, QC-after-press Thái Nguyên 45+, QC-after-press Mê Linh 37, In Thái Nguyên 33. These same accounts moved from tool-check to designer:
  - In Mê Linh: tool-check 108 → 51 → 1, designer 71 → 67 → 104.
  - QC-after-press Thái Nguyên: tool-check 43 → 4 → 3, designer 39 → 175 → 291.
  So "table users vs kanban users" are not two groups.
- **Entrance mix changed.** Tool-check send-backs carrying a typed reason: 108/219 (Jul) → 7/57 (Aug) → 3/4 (Sep). Designer send-backs carrying a reason: ~90% in every month. A required reason points to the kanban dialog, so designer send-backs are mostly kanban. Tool-check send-backs mostly came from the table cell or the scan station, never kanban. This is circumstantial: the entrance is not logged.
- **The kanban cannot reach Support at all:** `ReworkBackDialog.tsx:20` has `type Target = 'designer' | FulfillmentStage`.
- **"Printing-file problem" did not disappear, it was relabelled:** file-like reasons (regex, approximate) Jul 223 (43 tool-check + 180 designer) → Aug 90 (4 + 86) → Sep 201 (0 + 201).

Verdict: not provable whether the cause is (a) the problem went away or (b) the path is abandoned. The facts favour (b), but they do not prove it. So we run the experiment instead of guessing.

## 2. Phase 1 — small, correct under either hypothesis

| # | Change | Size |
|---|---|---|
| 1 | Add the **"Soát tool"** target to `ReworkBackDialog`. The BE path exists (`buildDesignerReworkBackFromError(target)` + `canReworkBackToSupport`, used by the table cell). Wiring only. | FE + one call |
| 2 | Fix the grey help text above the Support list. It says "ok = file ổn, chạy lại từ In", but for an order that ever had a designer it still goes back to the designer as "Cần làm lại", and `readyForFulfill=false` (`order.service.ts` ~6550–6566, same for `markToolCheckDone`). Make the text true for both cases. | i18n only |
| 3 | **Report, do not fix** (section 3). | doc |
| 4 | **Measure** for 2–3 weeks (section 4). | one mongosh query |

Support's own path (a ~900 px scroll past analytics, the date window hiding old holds, filters lost on leaving the page) is Phase 2 material; it is not touched in Phase 1.

## 2b. The price of the experiment (read before approving)

Adding the "Soát tool" target to the kanban **reopens a valve into the slowest lane**: median 11.7 h, p90 71 h, and 10% of send-backs never get a next human event. If (b) is right and workers use it, then during the 2–3 weeks of measuring, some orders will wait much longer than if they kept going the designer route as they do today. **This is an experiment on real orders of real customers.** It also changes how the factories operate, not only the software.

Cheapest ways to limit it — we recommend **(i)**:
- **(i) Enable at ONE site first: the Print stage at In Mê Linh** (150 of the 286 historical send-backs, so the signal comes fastest). Open the others only after reading the first weeks.
  **Stop rule — with a watcher, otherwise it does not exist.** Today nothing and nobody watches how long an order sits in the Support hold, so a "stop after 24 h" sentence alone would be a rule that lives only in a document (like the xlsx-import rule). The watcher is the existing twice-daily Telegram report (`scheduled-reports`, 11:30 and 17:00 VN). That report already carries a per-day "Cần làm lại" (Support hold) count, but only inside its 7-day cohort window and without any age — so a hold older than the window silently disappears, the very failure we fear. Add ONE line: total orders in the Support hold (marker pair, any age, excluding cancelled / unmapped / US-factory orders) and the age in hours of the oldest, marked with a warning sign above 24 h. No new screen, no new surface. Rule: the line shows the warning sign at two reports in a row → switch the target off at that site and keep the data.
  **Still needed from the owner:** one named person who reads that line and switches the target off (the report has a reader, the rule needs an owner). Name: ______ (to fill).
- (ii) Enable at both factories plus an alert to Support for holds older than N hours. More code and a new alert surface; the lane would still swallow orders silently until the alert is tuned.

Why (i): smaller, reversible in one switch, and the signal is fast enough. Cost of (i): a per-factory flag on `FactoryEntity` (same pattern as `flowType` / `autoCompletePack` / `skipToolCheck` / `autoStockOut`, so no new machinery) plus the one report line above. These are the only extra code beyond the target itself.

## 3. Reported, not fixed (data decisions belong to the project owner)

- **153 orders carry half a marker:** `productionErrorSource='tool-check'` while `toolResultNote='ok'` (134 completed with designer done, 10 rejected, 5 unassigned, 4 still open at QC-after-press / sew-out). Only 1 order carries the full marker today. Everything that checks the pair is correct. Anything that reads the source alone over-counts these 153. Candidates to verify, not yet traced: `designer-stats.service.ts` ~1490 and ~2297/2343 (OR with the source), and the `order.service.ts` ~9465 `$ne` filter. **No clean-up command will be run by me.**
- **Three numbers for "not yet checked":** banner 3, tab/badge 72, real queue (`remaining`) 67 — three filters, three sources of truth for one concept. **Two similarly named fields answer the same question "not yet checked" in different places** (the real trap for the next maintainer; the 72-vs-67 gap is only its symptom). `toolResult` = what kind of tool output exists (`has-tool` / `no-tool` / empty): the machine queue (`getNextDesignReviewOrder`) uses it. `toolResultNote` = the recorded outcome (`ok` / `error` / `no-pdf` / empty): the tab, the Telegram report, the dashboards and auto-assign use it. They are independent, and they disagree on both sides on dev today (all non-cancelled orders): `toolResult='has-tool'` with an empty note 2,210; empty `toolResult` with note `ok` 787; both empty 358. Per `Orders.md` §9b (hold reset) the internal flows read `toolResultNote` as "checked or not"; the queue reads `toolResult` as "has the machine run". Source of truth for "not yet checked" in internal flows: **`toolResultNote`**. `toolResult` is a legitimate gate ONLY for the machine queue. Not changed here; naming both explicitly (e.g. in code comments or a rename) is a Phase 2 candidate.
  Structural differences behind 72 vs 67: the tab lists orders with `toolResultNote` empty inside a date window (7 days by default), mapped and non-US factory. The queue lists `toolResult` empty + `designerStatus='unassigned'` + not held + not from a skip-tool-check factory, no date window unless the tool passes one. Re-measured today on dev (data moved since the 72/67 reading, so the exact 5 orders could not be reproduced and were not chased): of 98 tab orders, 26 are in the queue, 70 have `toolResult='has-tool'` and 2 have a designer already done.
- Import-xlsx "ok" does not re-flow: documented, but 0 uses in the entire log history. No action needed.

## 4. How we measure, and when the decision flips

> **WARNING — which source the measurement reads.** Count `fulfillmentTimeline[].reworkTarget='tool-check'` (with `at`, `byUserId`). **NEVER read `productionErrorCount`** (or any error dashboard built on it): the kanban path deliberately does NOT increment it (same as the kanban designer path), so once workers move to the kanban the error statistics will UNDER-count tool-check errors. Anyone reading those dashboards will see a low number and conclude "tool-check errors are rare" — the exact wrong conclusion that led here.

> **Prerequisite before the measuring phase — a human must click it once.** Turn the flag on for In Mê Linh, log in as an In Mê Linh worker, open the kanban, open "Báo lỗi" on a Print order and confirm the "Soát tool (Support)" chip is visible and that sending an order lands it in the Support list and the Telegram line. Tests pin the render condition (`tool-check-rework-gate.spec.ts`: one function shared by the dialog chip and the server guard, plus the flag lookup from `/factories/options`) but cannot replace a real click. If the chip is invisible, the measurement reads 0 for the wrong reason and would wrongly conclude "(a): the problem is gone".

Query: send-backs to tool-check per week from the 4 station accounts, split by target (`reworkTarget`), compared with the 0.1/day baseline of Sep.

- Tool-check send-backs **rise clearly** (say > 1 order/day from 4 accounts) → (b): people were blocked, not done. Phase 2 = make Support's path FAST and FINDABLE (hold never hidden by a date window, one-click exits, the same two exits collapsed to one meaning).
- They **stay ~0** after 2–3 weeks → (a): the problem is gone. Phase 2 = shrink the tab hard.
- Needs people, not data: ask 2–3 workers (In, QC-after-press) and Support why they pick "designer". That cannot be done from a database.

## 5. Phase 2 — conditional on the measurement; not approved

Size argument: of the 2,029 lines in `ToolCheckTab.tsx`, only ~290 (~14%) serve the daily work (the two lists + row cells). The rest is analytics: daily strip ~160, error statistics ~330, customer modal ~130, customer dialog ~155, helpers ~200, filters ~70, state ~790. Redesigning it on a guess is not proposed; redesign after the measurement is.

## 6. Click counts (from code; no write executed on dev)

| Who / path | Before |
|---|---|
| Worker, scan station | 2 scans, 0 clicks |
| Worker, table cell | 2 clicks |
| Worker, kanban | 3 clicks + typed reason, **no tool-check target** |
| Support, exit (a) Note → ok | 4 actions (sidebar, scroll, 2) |
| Support, exit (b) "Đã soát xong" | 3 actions |
| Support, hold older than the 7-day window | +5 (8–9 total) |

After Phase 1: kanban 3 clicks + reason, target present. Support unchanged.

## 7. Deliberately left alone

- The error catalog's 8 tool-check codes (1 seed + 7 worker-made): it is the workers' shared bucket; renaming it is a product decision.
- Auto design-review queue and the `skipToolCheck` flag.
- The (a)/(b) exit semantics: collapsing them touches the order state machine; wait for Phase 2 data.
