# T4 tool-definition notes

Context pointer for the tool-definitions ticket. Source files are on the
integration branch.

- Use `definePageTool` from `src/tools/ToolDefinition.ts:613` for all 14
  debugger tools. It adds `pageIdSchema` automatically when
  `args.pageIdRouting` is on, so do not declare `pageId` in each tool schema.
  The handler receives `request.page: ContextPage`.
- `ContextPage` is the `Readonly<{...}>` type at
  `src/tools/ToolDefinition.ts:503`, with the comment "Only add methods used
  by tools/*". T5 must add the debugger/script methods there; T4 should call
  only those methods, not reach into `McpPage` internals.
- `blockedByDialog: false` and `concurrency: 'page'` match
  `src/tools/logpoints.ts:39-40`. `debugger_wait_for_paused` uses
  `concurrency: 'none'` like `src/tools/comments.ts` (a wait that must not
  hold the page queue); see ADR 0002.
- File parameters use `verifyFilesSchema: {filePath: true}` as in
  `src/tools/screenshot.ts:199`. `ToolHandler.validateToolFiles()` resolves
  and validates these before the handler runs, so handlers receive an
  absolute path. Do not call `validatePath()` inside a handler.
- Tool names must be unique. `src/tools/tools.ts` uses
  `Object.values(<module>)` and sorts by name; export each factory as a named
  const from `src/tools/debugger.ts` and add one `import * as debuggerTools`
  line plus one spread entry.
- `conditions: ['javascriptEvaluation']` goes on `debugger_evaluate` and on
  any tool whose `condition` param is evaluated as JavaScript. All tools use
  `annotations.category = ToolCategory.DEBUGGING`; do not add a CLI flag or a
  new category.
- Formatter inputs are documented in `.spec/T1-INTERFACES.md`. Map CDP data
  into those explicitly named structures in the handler; formatters take
  tool-side 1-based coordinates and do not convert them.
- `DebuggerController` / `ScriptManager` method signatures will be recorded
  in their implementers' final reports. T4 must not invent them: read the
  merged `src/DebuggerController.ts` and `src/ScriptManager.ts` first.
