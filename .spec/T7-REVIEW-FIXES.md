# T7 code-review fixes

Consolidated fix list from the two-axis review of
`0b37364...integration/debugger-module`. Only findings verified against the
merged code are actioned; the review's mistaken claims are listed at the end
and must NOT be "fixed".

## Must fix (verified)

1. `DebuggerController.disable()` does not resume a paused page. Spec:
   "`debugger_disable` — resume if paused, remove own breakpoints, restore
   `skipAllPauses`, leave logpoints intact." Call the resume protocol command
   when `#paused` is set, before clearing it. Keep `disable()` synchronous by
   issuing the call without awaiting, or make the tool handler await a new
   async `disableAsync()`; do not break the existing `disable(): void`
   signature used by `McpPage`.
2. `ScriptManager.getScriptSource({filePath})` writes only the bounded preview
   lines (`selected.lines`), not the full source. Write the full script source
   (or the exact selected line range when one is given) and keep the response
   bounded (path + counts + at most five preview lines).
3. `ScriptManager` passes `options.filePath` straight to `fs.writeFile`, but
   `ToolHandler.validateAndResolvePathOrUrl` turns `file:` inputs into a
   `file:///...` URL string. Resolve a `file:` URL to a filesystem path with
   `fileURLToPath()` before writing; plain absolute paths pass through.
4. `definePageTool` paused guard: remove the redundant `typeof ... ===
   'function'` and optional chaining on a statically typed method; use a small
   helper that reads the paused state defensively without violating the
   "already type-safe" rule. The guard must remain tolerant of mock pages that
   have no implementation, otherwise the full unit suite regresses.
5. `tests/tools/debugger.test.ts` uses `] as const;` twice (lines ~49, ~65),
   violating the no-`as` rule. Replace with a plain array plus an explicit
   `readonly string[]` type annotation.
6. `debugger_set_breakpoint` XOR validation lives in the handler. Move it into
   the Zod schema using a `refine`, and make `ToolHandler` use the refined
   object schema. If the current tool-definition type only accepts a
   `Record<string, ZodType>` schema, add a narrow optional `refine` hook to
   `defineDebuggerTool` and have `ToolHandler` apply it; do not weaken the
   check.
7. `src/tools/debugger.ts` declares `DEFAULT_WAIT_TIMEOUT`,
   `MAX_WAIT_TIMEOUT`, `MAX_CONTEXT_LINES`, `MAX_BOUND` locally, duplicating
   values in `DebuggerController.ts` / `ScriptManager.ts`. Import the shared
   constants instead (export them from their owning modules if needed).
8. Formatting helpers (`formatObjectProperties`, `formatScriptList`,
   `formatScriptSource`) live in the tools file. Move them into
   `src/formatters/DebuggerFormatter.ts` as formatter classes with `toJSON()`
   / `toString()`, matching AGENTS.md. Keep tool output text unchanged.
9. Real-Chrome test: add `page.step()` coverage, assert a logpoint console
   message was produced without pausing, and replace the fixed 20 ms poll with
   an event/condition wait with a bounded timeout. Keep one browser run.

## Documentation / ticket hygiene

10. Close T7 in `.spec/TICKETS.md` with Evidence after fixes pass.
11. Update ADR 0001 with the same-line logpoint/breakpoint conflict already
    recorded in T6 (verify it is present).

## Verified but intentionally NOT changed (review misreads)

- "Second CDP session": none exists; the controller uses
  `TargetUniverse.session` and `DebuggerModel.agent`, as ADR 0001 requires.
- "as const" in production: absent; only the two test occurrences above.
- `DebuggerController` using `model.agent.invoke_*` is the agreed seam
  (`.spec/T2B-NOTES.md`); `DebuggerModel.Events` is not exported by mcp.
- `searchInScripts` local column/context derivation is required because CDP
  `SearchMatch` has no column; `WORKTREE-NOTES.md` documents the missing
  `TextUtils` export, so reusing `Script.searchInContent()` is not possible.
- `tests/mocks.ts` local fixture interfaces are explicit named types required
  by `isolatedDeclarations`; they are not hand-rolled `as unknown as` mocks.
- `AGENTS.md` / `docs/agents/*` / `.spec/*` are the local tracker and
  worktree bootstrap agreed with the user when GitHub issues were found
  disabled; they are not scope creep.
- Commit `bc8b6d8` mixes a ticket-close with a guard fix: hygiene note only,
  not worth rewriting history.

## Verification gate

`npm run build`, focused unit tests for all changed areas, the real-Chrome
integration test, `npm run gen` (only if tool schema/description changed),
`npm run format`, and `npm run test:no-build` core (non-e2e) suite. Report
exact spec-reporter counts.
