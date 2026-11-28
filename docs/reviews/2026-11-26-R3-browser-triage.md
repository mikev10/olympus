# Triage of the external reviews of R3, 2026-11-26

Two reviews, both counted, neither rerun: `2026-11-26-R3-browser-review-codex.md` (gpt-6-astra, 76,379 input tokens against a floor of 49,366) and `2026-11-26-R3-browser-review-gemini.md` (gemini-3.1-pro-preview, 69,070 against the same floor). Each reply matched its manifest's `replySha256` before its header was added.

## Counts

| Family | Findings | Hold | Hold in part | Hold as described, no defect | Do not hold |
|---|---|---|---|---|---|
| codex | 4 | 1 (codex-4) | 2 (codex-1, codex-2) | 1 (codex-3) | 0 |
| gemini | 1 | 0 | 0 | 1 (gemini-1) | 0 |

No finding was raised by both families. Three fixes applied, one limit recorded with an owner, two findings closed with no change.

Every finding was checked two ways before anything changed: by a fresh-context reader given the finding's text and the files and nothing about who wrote them, and by building the reviewer's construction and running it against the real browser. The reader confirmed all five descriptions match the code. The runs decided what each one causes.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | Hidden, clipped, or covered text can satisfy an expectation | codex | Holds in part: hidden text and clipped text both verified; "covered" not run | Fixed for text on an element that is not rendered. Clipped and covered recorded as a limit owned by R76, issue #252 |
| codex-2 | `fill` operates a disabled control; a click is not hit-tested | codex | Holds in part: the disabled `select` verified; the click claims describe what a person's click does | Fixed for `select`. No change for clicks |
| codex-3 | A request the page's CSP blocks is never reported | codex | Holds as described; not a violation of the rule it cites | Rejected, with the reason recorded (D-R3-17) |
| codex-4 | No assertion fails when the runner's separate script world is removed | codex | Holds | Fixed: an assertion added and shown failing without the world |
| gemini-1 | A length check in `compareBrowser` cannot be true on the adapter's path | gemini | Holds as described; the reviewer recommends keeping it | No change |

## codex-1: text nobody can see

**Checked.** A page with `<p style="display:none">Secret</p>` and `<p style="clip-path: inset(100%)">Clipped</p>`, observed by text.

**Found.** `Secret`: `matched: 1, visible: false, text: "Secret"`. The browser reported it correctly, and the adapter then held an expectation of `{ text: "Secret" }`, since only named fields were compared. That is a pass on a page that shows nothing. `Clipped`: `visible: true`. The reviewer's first construction is right: a clipped element reads as visible, so even `visible: true` holds.

**Separated.** The first is the adapter's comparison and is this unit's. The second is what `visible` means in the contract.

**Changed.** `compareObservation` requires a visible element for `text` and `value` unless the scenario names `visible` itself (D-R3-15). The test was shown failing first. Two fixes were possible: drop hidden elements in the runner's text finder, or require visibility in the comparison. The second was chosen: the browser keeps reporting what is there, hidden or not, and a scenario can still expect an element hidden.

**Not changed.** Clipped, covered, and off-screen elements still read as visible. A hit test would catch them and would read text under a transparent overlay as hidden; choosing between those is a contract question. Recorded as D-R3-16, owned by R76, issue #252.

## codex-2: a disabled control

**Checked.** A page with a disabled `<select>` and an enabled one holding a disabled option, each with a `change` handler that rewrites the title. `fill` on each.

**Found.** Both were set and both handlers ran: `value: "Large"`, `title: "Changed"`. The finding holds for `select`, where the runner sets the value and fires the events itself.

**The click claims.** A disabled button "reported as successfully clicked": the step is done and nothing happens, which is what a person gets, and the next observation shows the page unchanged. A covering element "can receive the click instead": it does, as it would for a person. Neither is a pass on a page that does not show what is expected. The same holds for typing into a disabled or read-only field, where real keystrokes do nothing.

**Changed.** `CHOOSE` refuses a disabled select and a disabled option, and the step fails (D-R3-15). The test was shown failing first, with a control that the enabled select still takes an enabled option.

## codex-3: a request the page's own policy blocks

**Checked.** A page with `Content-Security-Policy: img-src 'none'` and an image on another host.

**Found.** `blocked: []`. Chrome blocks the request before it reaches the proxy, as the reviewer says.

**Why nothing changed.** The rule the finding cites exists so a page cannot pass without something the sandbox withheld from it. This request is blocked by the page's own policy wherever the page runs. Nothing was withheld, and reporting it would fail pages for requests that are never sent (D-R3-17). The temporary fixture was removed.

## codex-4: the script world had no assertion

**Checked.** A page that redefines `innerText` and `textContent` in its own world to return the expected text, and writes what it then reads into its title.

**Found.** The browser reported `text: "Goodbye, Ada"` with `title: "page reads: Hello, Ada"`. The world works. The finding is right that nothing failed without it, which leaves a claim with no assertion behind it.

**Changed.** `I2.browser-verdict-judged-outside-the-product` judges that page and requires the mismatch to be on the text, with the title as the control that the rewrite took. With the runner's reads moved into the page's world, the entry fails: "a page that reports itself as showing the expected text held". A sandbox test covers the same page.

## gemini-1: an unreachable length check

**Checked.** `readBrowserScenario` and `readBrowseOutput` each force their list to the number of `observe` steps, so the `>` branch in `compareBrowser` is not reachable through the adapter.

**Found.** As described. `compareBrowser` is exported and pure, and the branch guards a direct caller. The reviewer recommends keeping it. No change.

## What neither review covered

Gemini left items 1, 3, 4, and 5 empty, and Codex left item 5 empty. Nobody examined whether the browser's own limits can be satisfied without doing what they appear to. That is silence, not clearance.
