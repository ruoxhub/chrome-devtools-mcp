/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {describe, it} from 'node:test';
import {promises as fs} from 'node:fs';
import path from 'node:path';

import type {McpPage} from '../src/McpPage.js';
import type {DevTools, ConsoleMessage} from '../src/third_party/index.js';
import {serverHooks} from './server.js';
import {createTempDir, html, withMcpContext} from './utils.js';

type ScriptId = DevTools.Protocol.Runtime.ScriptId;

function scriptId(value: string): ScriptId;
function scriptId(value: string): string {
  return value;
}

const APP_SCRIPT = `function add(a, b) {
  const sum = a + b;
  globalThis.debuggerFlag = 1;
  return sum;
}
globalThis.add = add;
globalThis.debuggerFlag = 0;
`;

function serveAppScript(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.statusCode = 200;
  res.end(APP_SCRIPT);
}

function waitForConsoleMessage(
  page: McpPage,
  predicate: (message: ConsoleMessage) => boolean,
  timeoutMs: number,
): Promise<{paused: boolean}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.pptrPage.off('console', listener);
      reject(
        new Error(`Console message did not arrive within ${timeoutMs}ms.`),
      );
    }, timeoutMs);
    const listener = (message: ConsoleMessage): void => {
      if (predicate(message)) {
        clearTimeout(timeout);
        page.pptrPage.off('console', listener);
        resolve({paused: page.getPausedState().paused});
      }
    };
    page.pptrPage.on('console', listener);
  });
}

describe('debugger integration', () => {
  const server = serverHooks();

  it('pauses at a breakpoint without being auto-resumed and still supports logpoints', async () => {
    await withMcpContext(async (_response, context) => {
      server.addRoute('/app.js', serveAppScript);
      server.addHtmlRoute('/', html`<script src="/app.js"></script>`);
      const page = context.getSelectedMcpPage();
      await page.pptrPage.goto(server.getRoute('/'));

      // A logpoint at a different line must remain non-pausing after the
      // Debug Session starts. DevTools owns one breakpoint per normalized
      // location, so the two must not share a line.
      const logpointMessage = waitForConsoleMessage(
        page,
        message => message.text() === 'returning',
        5_000,
      );
      await page.setLogpoints([
        {url: 'app.js', lineNumber: 4, expression: `'returning'`},
      ]);

      const breakpoint = await page.setBreakpoint({
        url: server.getRoute('/app.js'),
        lineNumber: 2,
      });
      assert.strictEqual(breakpoint.bound, true);

      // Evaluate the function in the page; execution should stop at line 2.
      const evaluation = page.pptrPage.evaluate('globalThis.add(1, 2)');
      const paused = page.waitForPaused({timeout: 5_000});
      await paused;

      const state = page.getPausedState();
      assert.strictEqual(state.paused, true);
      assert.ok(state.callFrames.length > 0);
      assert.strictEqual(state.callFrames[0].functionName, 'add');

      // The logpoint must not have paused on its own before the breakpoint.
      assert.strictEqual(
        state.hitBreakpoints.includes(breakpoint.breakpointId),
        true,
      );

      const stepped = await page.step('over', {timeout: 5_000});
      assert.strictEqual(stepped.status, 'paused');
      assert.ok(stepped.snapshot.generation > state.generation);
      assert.strictEqual(page.getPausedState().paused, true);

      await page.resume();
      assert.strictEqual(await evaluation, 3);
      assert.strictEqual(page.getPausedState().paused, false);
      assert.strictEqual((await logpointMessage).paused, false);

      // Script search and source export work over the real CDP session.
      const scripts = page.listScripts({urlFilter: 'app.js'});
      assert.ok(scripts.scripts.length > 0);
      const targetScriptId = scriptId(scripts.scripts[0].scriptId);
      const search = await page.searchInScripts({query: 'const sum'});
      assert.ok(search.matchCount > 0);

      using dir = createTempDir('debugger-');
      const filePath = path.join(dir.path, 'app.js');
      const source = await page.getScriptSource({
        scriptId: targetScriptId,
        filePath,
      });
      assert.strictEqual(source.filePath, filePath);
      const written = await fs.readFile(filePath, 'utf8');
      assert.ok(written.includes('const sum = a + b;'));

      await page.disable();
      await page.setLogpoints([]);
    });
  });
});
