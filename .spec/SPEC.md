# Spec: Debugger module and tools

Status: accepted (confirmed through `/grill-with-docs`, Q1–Q14).

## Goal

Add a debugger module and 14 MCP tools to `chrome-devtools-mcp`, enabling an AI
agent to set pausing breakpoints, inspect paused state, control execution, and
list/search/export parsed script sources — without duplicating existing
DevTools debugging infrastructure or adding npm dependencies.

## Context pointers

- Terms: [`GLOSSARY.md`](../GLOSSARY.md)
- Decisions: [`docs/adr/0003-share-devtools-debugger-session.md`](../docs/adr/0003-share-devtools-debugger-session.md),
  [`docs/adr/0004-paused-snapshots-and-tool-concurrency.md`](../docs/adr/0004-paused-snapshots-and-tool-concurrency.md)
- API and protocol details: [`docs/debugger-module-design.md`](../docs/debugger-module-design.md)
- Repo rules: [`AGENTS.md`](../AGENTS.md), [`docs/design-principles.md`](../docs/design-principles.md)
- Reference implementations (read-only, do not copy code):
  `D:/work/browser-cli/open-source/jshookmcp/src/modules/debugger`,
  `D:/work/browser-cli/src/modules/debugger`

## Scope

### In scope

- `src/DebuggerController.ts` — Debug Session, breakpoints, Paused Snapshot,
  execution control, pause generation.
- `src/ScriptManager.ts` — script listing, source read, cross-script search,
  source export.
- `src/tools/debugger.ts` — 14 tool definitions.
- `src/formatters/DebuggerFormatter.ts` — breakpoints, call stacks, scopes,
  evaluation results, search matches.
- `src/McpPage.ts` — owns both classes, lifecycle, and the paused-page guard.
- `src/BUILD.gn`, `tests/BUILD.gn`, `src/tools/tools.ts` registrations.
- Unit tests, focused real-Chrome integration tests, generated docs.

### Tools (14)

1. `debugger_set_breakpoint` — `url` or `scriptId`, 1-based `lineNumber`,
   optional `columnNumber` and `condition`; reports `breakpointId`, requested
   and resolved locations.
2. `debugger_list_breakpoints` — only this module's breakpoints.
3. `debugger_remove_breakpoint` — by `breakpointId`.
4. `debugger_pause` — `Debugger.pause` plus bounded wait.
5. `debugger_resume` — invalidates the pause generation.
6. `debugger_step` — `direction: into | over | out`; waits for the next pause.
7. `debugger_disable` — resume if paused, remove own breakpoints, restore
   `skipAllPauses`, leave logpoints intact.
8. `debugger_wait_for_paused` — `concurrency: 'none'`, default 10 s, max 30 s.
9. `debugger_get_paused_state` — reason, hit breakpoints, call frames;
   scopes opt-in.
10. `debugger_evaluate` — `callFrameId`/expression, `returnByValue`,
    `generatePreview`, `throwOnSideEffect`, `timeout`; gated by
    `javascriptEvaluation`.
11. `debugger_get_object_properties` — bounded `Runtime.getProperties`.
12. `list_scripts` — from `DebuggerModel.scripts()`, bounded.
13. `get_script_source` — 1-based line range, optional `filePath` export,
    bounded preview.
14. `search_in_scripts` — CDP `Debugger.searchInContent` across scripts;
    `caseSensitive`, `isRegex`, `urlFilter`, `contextLines`, `maxMatches`,
    `maxScripts`, `excludeMinified`, optional export.

### Out of scope

Watch expressions, XHR/event breakpoints, blackboxing, function trees,
keyword indexes, disk script caches, saved debugger sessions, exception-pause
configuration, `getPossibleBreakpoints`, frame restart/variable mutation, MCP
notifications, new CLI flags, new npm dependencies, changes to
`third_party/devtools-frontend`.

## Hard constraints

- Reuse the page's existing `DebuggerModel` and CDP session. Do not create a
  second `Debugger.enable` session: the universe sets `skipAllPauses=true` and
  its model auto-resumes on `Debugger.paused`.
- Only `DebuggerModel` owns pause/resume handling; share breakpoint ownership
  with logpoints but keep the two sets distinct.
- Entering a Debug Session changes `skipAllPauses` to false; disabling or
  disposing restores the original non-pausing behavior.
- Tool coordinates are 1-based; CDP `Location` is 0-based. Convert once at
  the boundary.
- CDP `SearchMatch` has only `lineNumber` and `lineContent`. Derive column
  offsets and context locally (reuse `Script.searchInContent()`).
- `callFrameId`/`objectId` are valid only while paused. generation increments
  on each pause; resume/step/navigation/disable invalidates stored snapshots.
- Script tools must not enable pausing mode.
- Paused page: unrelated page tools fail fast with resume guidance; debugger
  tools remain available.
- TypeScript: no `any`, `as`, `!`, `@ts-ignore`; use `#private`; `for..of`.
- Puppeteer internals only through `src/third_party/index.ts`.
- Paths validated via `validatePath()` / `verifyFilesSchema`.
- New formatter exposes `toJSON()` and `toString()` using it.
- Tests: `createHandlerMocks()`, `sinon.assert`, current-year copyright.

## Acceptance

- `npm run gen`, `npm run format`, `npm run test` all pass.
- Real-Chrome test proves a breakpoint pauses and is NOT auto-resumed by the
  universe, logpoints still only log, step/resume work, and CDP search/source
  export work.
- Tool reference docs include all 14 tools with unique names.
- `code-review` findings fixed on the integration branch.

## Local ticket tracker

GitHub issues are disabled on this fork, so tickets live in
[`TICKETS.md`](./TICKETS.md). Each ticket is resolved by marking it `closed`
with a short evidence note in that file.
