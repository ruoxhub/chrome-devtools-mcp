/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Bootstraps a git worktree so `npm run build` / `npm run test` can run in it.
// The repo's heavy, untracked dependencies (the devtools-frontend submodule
// contents and node_modules) are shared from the main checkout via NTFS
// junctions. `scripts/link-devtools-deps.ts` creates the remaining links.
//
// Usage (from the main checkout):
//   node .spec/bootstrap-worktree.mjs <worktree-path>
//
// Cleanup before `git worktree remove`: run with --unlink to remove only the
// junctions/symlinks, never the shared targets.

import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, rmSync, symlinkSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const worktree = process.argv[2];
const unlink = process.argv.includes('--unlink');

const shared = ['third_party/devtools-frontend', 'node_modules'];
const generatedLinks = [
  'build',
  'buildtools',
  'build_overrides',
  'third_party/ninja',
  'third_party/node',
  'third_party/typescript',
  'third_party/cpython3',
];

if (!worktree) {
  console.error(
    'Usage: node .spec/bootstrap-worktree.mjs <worktree-path> [--unlink]',
  );
  process.exit(1);
}

for (const rel of [...shared, ...generatedLinks]) {
  const link = resolve(worktree, rel);
  try {
    const stat = lstatSync(link);
    // Never delete a real directory in the shared targets.
    if (
      stat.isSymbolicLink() ||
      (stat.isDirectory() && !existsSync(resolve(link, '.git')))
    ) {
      rmSync(link, {recursive: true, force: true});
    }
  } catch {
    // Path does not exist yet.
  }
  if (unlink) {
    continue;
  }
  if (shared.includes(rel)) {
    const target = resolve(root, rel);
    if (!existsSync(target)) {
      throw new Error(`Shared target missing: ${target}`);
    }
    // rmSync above removed the empty submodule placeholder directory.
    symlinkSync(
      target,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    console.error(`linked ${rel}`);
  }
}

if (!unlink) {
  execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      resolve(root, 'scripts/link-devtools-deps.ts'),
    ],
    {cwd: worktree, stdio: 'inherit'},
  );
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', resolve(root, 'scripts/gn-gen.ts')],
    {cwd: worktree, stdio: 'inherit'},
  );
  console.error('worktree ready');
}
