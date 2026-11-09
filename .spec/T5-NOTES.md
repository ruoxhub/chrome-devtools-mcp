# T5 McpPage integration notes

Context pointer for the McpPage lifecycle integration ticket.

## Parallel uncommitted work in the main checkout

As of 21:18 the main checkout `D:/work/chrome-devtools-mcp` has uncommitted
changes from another, unrelated task: `McpContext.ts`, `McpPage.ts`,
`config/mcp-options.ts`, `tools/ToolDefinition.ts`, `tools/screencast.ts`,
several tests, and a new `formatters/ScreencastFormatter.ts`. These are NOT
part of the debugger spec. Do not clean, stage, overwrite, or commit them.
Work only in the T5 worktree, which has a clean baseline from the integration
branch.

Because T5 also edits `src/McpPage.ts` and (for `ContextPage` methods)
`src/tools/ToolDefinition.ts`, its diff must be surgical: add only the
debugger/script-manager methods, the paused-page guard, and the dispose
order. Match the surrounding style and do not reformat or refactor adjacent
code. If the integration-branch version differs from the main checkout's
uncommitted version, the integration branch is authoritative for this spec.

## Wiring contract

- `ContextPage` at `src/tools/ToolDefinition.ts:503` is a `Readonly<{...}>`
  type with the comment "Only add methods used by tools/*". T5 adds the
  debugger and script-manager methods there; T4 calls only those.
- `.spec/T4-NOTES.md` documents the tool-definition side.
- `.spec/T2B-NOTES.md` documents `invalidatePausedState()` as the navigation
  hook T5 must call.
- `McpPage.dispose()` currently disposes comment bridge, screen recorder,
  collectors, logpoint manager, then the DevTools universe and detaches its
  session (`src/McpPage.ts:900-923`). T5 must dispose the controller and
  script manager BEFORE detaching the universe session, and must not detach
  the session twice.

## Paused-page guard

While the page is paused, unrelated page tools must fail fast with actionable
resume guidance instead of reaching Puppeteer and waiting for the protocol
timeout. Debugger tools are exempt. Put the check at the shared page-tool
execution boundary (see `ToolHandler`'s `#runBrowserTool` / page acquisition),
not in each of the 14 handlers, and keep `debugger_wait_for_paused`
(`concurrency: 'none'`) unaffected. See ADR 0002.
