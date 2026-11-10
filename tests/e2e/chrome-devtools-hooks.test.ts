/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {McpPage} from '../../src/McpPage.js';
import {createHook, removeHook} from '../../src/tools/hooks.js';

import {serverHooks} from '../server.js';
import {html, waitExecutionFor, withMcpContext} from '../utils.js';

/**
 * A page that defines its own function in its own script, which is what a
 * persistent hook has to cope with: the hook script runs before this one.
 */
function functionPage(): string {
  return html`<script>
    window.app = {
      calls: 0,
      save: function (payload) {
        this.calls++;
        return 'saved:' + payload.name;
      },
    };
  </script>`;
}

function hookLogs(page: McpPage): string[] {
  return page
    .getConsoleData(true)
    .flatMap(message =>
      'text' in message && typeof message.text === 'function'
        ? [message.text()]
        : [],
    )
    .filter(text => text.includes('[Hook]'));
}

describe('page hooks', () => {
  const server = serverHooks();

  it('hooks a function a later document defines, when persistent', async () => {
    server.addHtmlRoute('/hook-first', functionPage());
    server.addHtmlRoute('/hook-second', functionPage());
    await withMcpContext(async (response, context, args) => {
      const page = context.getSelectedMcpPage();
      await page.pptrPage.goto(server.getRoute('/hook-first'));

      await createHook(args).handler(
        {
          params: {
            type: 'function',
            target: 'window.app.save',
            persist: true,
          },
          page,
        },
        response,
        context,
      );

      await page.pptrPage.goto(server.getRoute('/hook-second'));

      // The hook script retries until the page defines its target, so the call
      // that proves the hook works has to be repeated until it is patched.
      let returned: unknown;
      await waitExecutionFor(async () => {
        returned = await page.pptrPage.evaluate(
          `window.app.save({name: 'second-document'})`,
        );
        const logs = hookLogs(page);
        assert.ok(
          logs.some(text => text.includes('window.app.save called')),
          `The hook should log the call in the new document: ${JSON.stringify(logs)}`,
        );
        assert.ok(
          logs.some(text =>
            text.includes('window.app.save returned saved:second-document'),
          ),
          `The hook should log the result in the new document: ${JSON.stringify(logs)}`,
        );
      }, 5000);
      assert.equal(returned, 'saved:second-document');
    });
  });

  it('stops hooking a later document once the hook is removed', async () => {
    server.addHtmlRoute('/hook-removed-first', functionPage());
    server.addHtmlRoute('/hook-removed-second', functionPage());
    await withMcpContext(async (response, context, args) => {
      const page = context.getSelectedMcpPage();
      await page.pptrPage.goto(server.getRoute('/hook-removed-first'));

      await createHook(args).handler(
        {
          params: {
            type: 'function',
            target: 'window.app.save',
            persist: true,
          },
          page,
        },
        response,
        context,
      );
      await removeHook(args).handler({params: {}, page}, response, context);

      await page.pptrPage.goto(server.getRoute('/hook-removed-second'));
      await page.pptrPage.evaluate(`window.app.save({name: 'not-hooked'})`);
      await page.pptrPage.evaluate(`console.log('sentinel')`);
      await waitExecutionFor(async () => {
        assert.ok(
          page
            .getConsoleData(true)
            .some(
              message =>
                'text' in message &&
                typeof message.text === 'function' &&
                message.text().includes('sentinel'),
            ),
          'The sentinel log should have been collected',
        );
      }, 5000);

      assert.deepEqual(hookLogs(page), []);
    });
  });

  it('reports a hook that cannot patch the current document', async () => {
    server.addHtmlRoute('/hook-missing', functionPage());
    await withMcpContext(async (response, context, args) => {
      const page = context.getSelectedMcpPage();
      await page.pptrPage.goto(server.getRoute('/hook-missing'));

      await assert.rejects(
        createHook(args).handler(
          {
            params: {
              type: 'function',
              target: 'window.app.missing',
              persist: false,
            },
            page,
          },
          response,
          context,
        ),
        /Failed to hook window\.app\.missing: window\.app\.missing is not a function\./,
      );
      assert.deepEqual(page.getHooks(), []);
    });
  });
});
