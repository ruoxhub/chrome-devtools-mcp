# T2 fixture notes (context pointer for T2a/T2b)

`createMockTargetUniverse(model)` in `tests/mocks.ts:606` returns a
`sinon.createStubInstance(DevTools.Foundation.Universe.Universe)` whose
`settings` is a getter backed by a private context, so reading
`universe.settings` in a test throws `TypeError: Cannot read properties of
undefined (reading 'get')`, and `settings.resolve` cannot be configured with
`.returns`.

Do not change `tests/mocks.ts` (outside both tickets' write scopes). Instead,
in the test file, build a local `TargetUniverse`-shaped fixture with an
explicitly named interface describing only what the controller reads, for
example:

```ts
interface SettingsLike {
  resolve(descriptor: unknown): {set(value: boolean): void};
}
interface UniverseLike {
  settings: SettingsLike;
}
```

Use `sinon.stub()` for `resolve` and `set`, and assemble the object with
`createMockCDPSession()` for `session`. Avoid `as`, `any`, `!`,
`as unknown as`, and stubbing the real `Universe` / `Setting` classes. The
project's `isolatedDeclarations` setting requires the fixture interface to be
explicitly named and exported if it crosses a helper-function boundary.

`DevTools.DebuggerModel.Events` is not exported from `mcp/mcp.js`. The
controller therefore listens on the existing `TargetUniverse.session` events
`'Debugger.paused'` / `'Debugger.resumed'`; it must not create a second
session or call `Debugger.enable`. See ADR 0001 and `WORKTREE-NOTES.md` for
the DevTools export constraint.
