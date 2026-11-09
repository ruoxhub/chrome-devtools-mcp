# Tickets

Tracker for [`SPEC.md`](./SPEC.md). GitHub issues are disabled for this fork;
`tickets` are resolved by changing `status: open` to `status: closed` and
appending an `Evidence:` line. A ticket is ready when every ticket in its
`Blocked by:` list is closed. Do not edit a ticket's write scopes without
updating the graph.

Worktree bootstrap: `node .spec/bootstrap-worktree.mjs <worktree-path>` from
the main checkout, and the same with `--unlink` before `git worktree remove`.
Every implementer works in its own worktree on its own branch off the
integration branch, and runs `npm run build`, the focused test, and
`npm run format` before reporting done.

---

## T1 — DebuggerFormatter

- **status**: open
- **Branch**: `ticket/T1-debugger-formatter`
- **Blocked by**: —
- **Write scopes**: `src/formatters/DebuggerFormatter.ts`,
  `tests/formatters/DebuggerFormatter.test.ts`, `src/BUILD.gn`, `tests/BUILD.gn`
- **Acceptance**:
  - New formatter class exposes `toJSON()` and `toString()` built from it.
  - Formats breakpoint records (requested/resolved 1-based positions), paused
    state (reason, hit breakpoints, call frames), scope/property summaries,
    evaluation results/exceptions, and search matches with bounded context.
  - Reuses `formatRemoteObject` from `src/formatters/RemoteObjectFormatter.ts`;
    no new formatter duplicates it.
  - Unit test calls every public method and asserts truncation/bounds.
  - `npm run build` and the focused test pass.

---

## T2 — DebuggerController

- **status**: open
- **Branch**: `ticket/T2-debugger-controller`
- **Blocked by**: —
- **Write scopes**: `src/DebuggerController.ts`, `tests/DebuggerController.test.ts`,
  `src/BUILD.gn`, `tests/BUILD.gn`
- **Acceptance**:
  - Owns Debug Session state for one page using the existing
    `TargetUniverse`/`DebuggerModel` passed in; never creates a second CDP
    session.
  - `enable()` sets `skipAllPauses=false`; `disable()` resumes if paused,
    removes only its own breakpoints, restores `skipAllPauses=true`, and clears
    listeners/waiters.
  - Breakpoint set/list/remove with 1-based → 0-based conversion; keep own
    breakpoint set distinct from logpoints.
  - `waitForPaused(timeout)` is event-driven with bounded timeout; each pause
    increments `generation`; resume/step/navigation disable invalidate stored
    snapshots and reject stale `callFrameId`/`objectId`.
  - Execution control: pause (with bounded wait), resume, step into/over/out.
  - Inspection: paused state (scopes opt-in), evaluate on call frame, bounded
    `Runtime.getProperties`.
  - `dispose()` is idempotent and releases every listener/waiter.
  - Core-class unit tests with mocked dependencies cover each branch; no real
    browser and no `as`/`any`/`!`.
  - `npm run build` and focused test pass.

---

## T3 — ScriptManager

- **status**: open
- **Branch**: `ticket/T3-script-manager`
- **Blocked by**: —
- **Write scopes**: `src/ScriptManager.ts`, `tests/ScriptManager.test.ts`,
  `src/BUILD.gn`, `tests/BUILD.gn`
- **Acceptance**:
  - `listScripts` reads `DebuggerModel.scripts()` with URL filter and bounded
    count; reports `scriptId`, URL, length, source-map metadata.
  - `getScriptSource(scriptId, line range, filePath?)` uses DevTools
    `Script.requestContentData()`/CDP `getScriptSource`, supports 1-based line
    ranges and bounded preview; optional file export returns path + summary,
    never the whole source in the tool response.
  - `searchInScripts` uses `Script.searchInContent()`/`Debugger.searchInContent`
    with `caseSensitive`, `isRegex`, `urlFilter`, `contextLines`, `maxMatches`,
    `maxScripts`, `excludeMinified`; column offsets derived locally from
    `lineContent` because CDP `SearchMatch` has none.
  - No keyword index, Babel, function tree, disk cache, or new dependency.
  - Does not change `skipAllPauses` or enable a Debug Session.
  - Mock-based unit tests cover bounds, filters, regex, and export behavior.
  - `npm run build` and focused test pass.

---

## T4 — Tool definitions and registration

- **status**: open
- **Branch**: `ticket/T4-debugger-tools`
- **Blocked by**: T1, T2, T3
- **Write scopes**: `src/tools/debugger.ts`, `src/tools/tools.ts`,
  `tests/tools/debugger.test.ts`, `src/BUILD.gn`, `tests/BUILD.gn`
- **Acceptance**:
  - All 14 tools from `SPEC.md` with exact names, Zod schemas, descriptions,
    `ToolCategory.DEBUGGING`, `concurrency` values (`page` for mutations,
    `none` for `debugger_wait_for_paused`), `blockedByDialog: false`, and
    `verifyFilesSchema` for `filePath` parameters.
  - `conditions: ['javascriptEvaluation']` only on `debugger_evaluate` and
    breakpoint conditions.
  - Handlers delegate to `McpPage` methods with exact arguments; no business
    logic in handlers beyond formatting the response.
  - `createTools()` includes the new module; tool names remain unique.
  - `createHandlerMocks()` tests verify exact arguments, error branches, and
    gating without a real browser.
  - `npm run build` and focused test pass.

---

## T5 — McpPage lifecycle integration

- **status**: open
- **Branch**: `ticket/T5-mcppage-integration`
- **Blocked by**: T2, T3
- **Write scopes**: `src/McpPage.ts`, `tests/McpPage.test.ts`
- **Acceptance**:
  - `McpPage` owns `DebuggerController` and `ScriptManager`, created lazily from
    `devtoolsUniverse`; both usable through the page tool context.
  - `dispose()` disposes controller and script manager before detaching the
    universe session; no double detach.
  - While the page is paused, unrelated page tools fail fast with actionable
    resume guidance and do not reach Puppeteer; debugger tools are exempt.
  - Navigation/reload invalidates the pause snapshot; source maps still sync.
  - `tests/McpPage.test.ts` covers the guard and disposal order with mocks.
  - `npm run build` and focused test pass.

---

## T6 — Generated docs and real-Chrome integration tests

- **status**: open
- **Branch**: `ticket/T6-integration-and-docs`
- **Blocked by**: T4, T5
- **Write scopes**: `docs/tool-reference.md`, `docs/slim-tool-reference.md`,
  `tests/e2e/debugger.test.ts`, `tests/BUILD.gn`
- **Acceptance**:
  - `npm run gen` regenerates tool reference with all 14 tools under
    Debugging.
  - One bounded real-Chrome integration scenario proves: a pausing breakpoint
    actually pauses and is not auto-resumed, logpoint still only logs,
    step/resume work, script search and source export are correct.
  - Fewer than a handful of slow browser runs; no fixed sleeps.
  - `npm run gen`, `npm run format`, and the full `npm run test` pass.

---

## T7 — Code review fixes

- **status**: open
- **Branch**: `ticket/T7-review-fixes`
- **Blocked by**: T6
- **Write scopes**: repository-wide (review-driven)
- **Acceptance**:
  - Run the `code-review` skill on the integration branch.
  - Fix every finding in one fresh implementer worktree.
  - Re-run `npm run build`, `npm run format`, `npm run test` after fixes.
  - Record the review outcome and evidence below.

---

## Graph

```text
T1 ─┐
T2 ─┼─┬─ T5 ─┐
T3 ─┘ └─ T4 ─┴─ T6 ─ T7
```

Frontier at start: T1, T2, T3 (no blockers). T4 waits for T1/T2/T3;
T5 waits for T2/T3; T6 waits for T4/T5; T7 waits for T6.
