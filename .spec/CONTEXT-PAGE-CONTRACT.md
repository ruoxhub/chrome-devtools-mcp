# ContextPage debugger contract

T4 and T5 share this contract. T4 calls `request.page.<method>`; T5 adds the
same methods to `ContextPage` (`src/tools/ToolDefinition.ts`) and implements
them on `McpPage` by delegating to `DebuggerController` / `ScriptManager`.
Method names and option fields are taken from the merged implementations; do
not invent new ones.

## DebuggerController methods (from `src/DebuggerController.ts`)

```text
setBreakpoint(options: SetBreakpointOptions): Promise<BreakpointRecord>
listBreakpoints(): readonly BreakpointRecord[]
removeBreakpoint(breakpointId: string): Promise<boolean>
waitForPaused(options?: {timeout?: number}): Promise<PausedSnapshot>
pause(options?: {timeout?: number}): Promise<PauseResult>
resume(): Promise<void>
step(direction: 'into'|'over'|'out', options?: {timeout?: number}): Promise<PausedStateView | PendingPauseResult>
getPausedState(options?: {includeScopes?: boolean}): PausedStateView
evaluateOnCallFrame(options: EvaluateOptions): Promise<EvaluationResultLike>
getObjectProperties(options: GetObjectPropertiesOptions): Promise<ObjectPropertiesView>
enable(): void
disable(): void
dispose(): void
invalidatePausedState(): void
```

T4 wires `debugger_disable` to `page.disable()`, and the first breakpoint or
execution-control call must enter the Debug Session through `page.enable()`.
Use the exact exported option/result interfaces from
`src/DebuggerController.ts`; T4's tests already import
`BreakpointRecord`, `PausedStateView`, `EvaluationResultLike`,
`ObjectPropertiesView`, `PauseResult`, `PendingPauseResult`, and
`PausedSnapshot`.

## ScriptManager methods (from `src/ScriptManager.ts`)

```text
listScripts(options?: ListScriptsOptions): ScriptListResult
getScriptSource(options: GetScriptSourceOptions): Promise<ScriptSourceResult>
searchInScripts(options: SearchInScriptsOptions): Promise<ScriptSearchResult>
```

## T4 test references

`tests/tools/debugger.test.ts` (produced by the T4 implementer) references
exactly these page methods:

```text
page.setBreakpoint, page.listBreakpoints, page.removeBreakpoint,
page.pause, page.resume, page.step, page.disable, page.waitForPaused,
page.getPausedState, page.evaluateOnCallFrame, page.getObjectProperties,
page.listScripts, page.getScriptSource, page.searchInScripts
```

`createHandlerMocks()` returns `createStubInstance(McpPage)`, so T5 must add
the methods to `McpPage` for the stubs to exist. No `as`/`any`/`!` adapters.
