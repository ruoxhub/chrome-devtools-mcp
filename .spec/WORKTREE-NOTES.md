# Worktree environment notes

New worktrees do not contain the checked-out `third_party/devtools-frontend`
submodule, `node_modules`, or the GN symlinks. `.spec/bootstrap-worktree.mjs`
shares the first two from the main checkout with junctions, runs
`scripts/link-devtools-deps.ts` and `scripts/gn-gen.ts`, and enables
`extensions.worktreeConfig`.

The shared submodule junction contains a `.git` file whose relative `gitdir`
resolves outside the worktree, so plain `git status` in a worktree fails with
`fatal: not a git repository: .../.git/modules/devtools-frontend`. The
bootstrap script fixes this by writing into each worktree's private
`config.worktree` (never the common config):

```text
[submodule "devtools-frontend"]
  ignore = all
[diff]
  ignoreSubmodules = all
```

The main checkout keeps only `extensions.worktreeConfig = true`; do not set
`submodule.*.ignore` or `diff.ignoreSubmodules` in the common config.

Before removing a worktree, run the bootstrap script with `--unlink` to remove
junctions/symlinks without deleting the shared targets, then
`git worktree remove --force <path>`.

Verified end to end: bootstrap → `git status` exit 0 → `node scripts/ninja.ts`
exit 0. Fixes are committed as `c631541` (lint) and `70f6a16` (submodule
isolation).

## DevTools exports

`third_party/devtools-frontend/mcp/mcp.ts` does not export `Script` or
`TextUtils` namespaces. Do not import devtools-frontend internals directly from
`src/` or `tests/`. Use the exported `DevTools.DebuggerModel` (via
`third_party/index.ts`), its `scripts()` and `agent.invoke_*` methods, and
`DevTools.Protocol` types. Tests can describe the fields a class actually
reads with a local explicitly named interface instead of stubbing the real
`Script` class.
