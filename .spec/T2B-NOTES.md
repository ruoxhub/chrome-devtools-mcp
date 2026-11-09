# T2b implementation contract

Read `src/DebuggerController.ts` on the integration branch AFTER T2a is
merged. T2a leaves two deliberate seams for T2b:

- `#pausedListener = (): void => {}` and
  `#resumedListener = (): void => {}` are registered on the existing
  `TargetUniverse.session` events `'Debugger.paused'` / `'Debugger.resumed'`
  by `enable()` and removed by `disable()`. T2b fills these handlers; it must
  not change how listeners are registered or create another session.
- `disable()` and `dispose()` already restore `skipAllPauses`, remove the
  controller's own breakpoints, and clear listeners. T2b must ALSO reject all
  pending `waitForPaused` waiters and invalidate the current Paused Snapshot
  from those paths.

T2a's public surface (do not rename):

```text
constructor(devtools: DevtoolsLike)
enable(): void
disable(): void
dispose(): void
setBreakpoint(options: SetBreakpointOptions): Promise<BreakpointRecord>
listBreakpoints(): readonly BreakpointRecord[]
removeBreakpoint(breakpointId: string): Promise<boolean>
```

`DevtoolsLike`, `SettingsLike`, `DebuggerAgentLike`, `DebuggerLocation`,
`SetBreakpointOptions`, `BreakpointRecord` are local explicitly named
interfaces in the same file. T2b should add its own `PausedEventLike`,
`CallFrameLike`, `ScopeLike`, `RemoteObjectLike`, `PausedSnapshot` and
`EvaluationResultLike` interfaces in the same style: describe only the fields
the controller actually reads. Do not import `Script`, `TextUtils` or
`DebuggerModel.Events` (see `.spec/WORKTREE-NOTES.md`).

T2b must add, without changing T2a method signatures:

```text
waitForPaused(options?: {timeout?: number}): Promise<PausedSnapshot>
getPausedState(options?: {includeScopes?: boolean}): PausedSnapshot | structured view
pause(options?: {timeout?: number}): Promise<PausedSnapshot | pending result>
resume(): void  (or Promise<void>, be consistent with the agent response)
step(direction: 'into'|'over'|'out', options?: {timeout?: number}): ...
evaluateOnCallFrame(options: {...}): Promise<EvaluationResultLike>
getObjectProperties(options: {objectId: string; ...}): Promise<...>
invalidatePausedState(): void  (navigation hook, called by T5)
```

Rules from ADR 0002 and `docs/debugger-module-design.md`:

- Each `'Debugger.paused'` increments a `generation` counter and stores one
  Paused Snapshot. `callFrameId` / `objectId` are valid only while paused.
- `resume`, `step`, `disable`, `dispose` and navigation invalidate the stored
  snapshot; later references to stale IDs must throw an explicit error.
- `waitForPaused` is event-driven with a bounded timeout (default 10 s, max
  30 s), no polling; `disable()`/`dispose()` reject every pending waiter.
- `step` must wait for the NEXT pause, never return the previous snapshot.
- `pause` sends `Debugger.pause` (which stops on the next statement) and then
  waits with a bound; a timeout returns an explicit pending result.
- Use `DebuggerAgentLike`-style explicit interfaces for
  `invoke_resume`, `invoke_pause`, `invoke_stepInto`, `invoke_stepOver`,
  `invoke_stepOut`, `invoke_evaluateOnCallFrame`, and
  `Runtime.getProperties` via the session (`session.send('Runtime.getProperties', ...)`).
  Add these to the existing agent/session interfaces rather than using `any`.

Tests: extend `tests/DebuggerController.test.ts` with the T2b branches
listed in `.spec/TICKETS.md`. Reuse the local fixture from T2a; do not edit
`tests/mocks.ts`. No `as`/`any`/`!`/`as unknown as`.
