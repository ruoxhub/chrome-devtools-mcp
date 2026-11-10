/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import type {Hook, HookInjection} from '../../src/HookManager.js';
import {createHook, removeHook} from '../../src/tools/hooks.js';
import {createHandlerMocks} from '../mocks.js';

const FUNCTION_HOOK: Hook = {
  id: 'hook-1',
  type: 'function',
  target: 'window.fetch',
  action: 'log',
  persist: false,
};

const INJECTION: HookInjection = {
  hook: FUNCTION_HOOK,
  applied: true,
  detail: 'window.fetch is hooked',
};

describe('create_hook', () => {
  it('passes the hook to the page and reports the resulting hooks', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.createHook.resolves(INJECTION);
    page.getHooks.returns([FUNCTION_HOOK]);

    await createHook(args).handler(
      {params: {type: 'function', target: 'window.fetch'}, page},
      response,
      context,
    );

    sinon.assert.calledOnceWithExactly(page.createHook, {
      type: 'function',
      target: 'window.fetch',
      action: 'log',
      persist: false,
    });
    sinon.assert.calledWithExactly(
      response.appendResponseLine.firstCall,
      'Created hook-1: function window.fetch, action: log, current document only.',
    );
    sinon.assert.calledWithExactly(
      response.appendResponseLine.secondCall,
      'The hook is active in the current document.',
    );
    sinon.assert.calledWithExactly(
      response.appendResponseLine.thirdCall,
      'Hooked operations report to console.log; read them with list_console_messages.',
    );
    sinon.assert.calledWithExactly(
      response.appendResponseLine.lastCall,
      'Hooks on this page: hook-1 (function window.fetch).',
    );
  });

  it('passes every optional parameter to the page', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.createHook.resolves(INJECTION);
    page.getHooks.returns([]);

    await createHook(args).handler(
      {
        params: {
          type: 'function',
          target: 'window.fetch',
          action: 'block',
          customCode: 'console.log("custom");',
          maxCalls: 5,
          minInterval: 100,
          persist: true,
        },
        page,
      },
      response,
      context,
    );

    sinon.assert.calledOnceWithExactly(page.createHook, {
      type: 'function',
      target: 'window.fetch',
      action: 'block',
      customCode: 'console.log("custom");',
      maxCalls: 5,
      minInterval: 100,
      persist: true,
    });
  });

  it('rejects a target-based type without a target', async () => {
    const {page, context, response, args} = createHandlerMocks();

    await assert.rejects(
      createHook(args).handler(
        {params: {type: 'object-method'}, page},
        response,
        context,
      ),
      /The "object-method" hook type requires a target/,
    );
    sinon.assert.notCalled(page.createHook);
  });

  it('rejects an object-method target without an object prefix', async () => {
    const {page, context, response, args} = createHandlerMocks();

    await assert.rejects(
      createHook(args).handler(
        {params: {type: 'object-method', target: 'stringify'}, page},
        response,
        context,
      ),
      /requires a target with an object prefix/,
    );
    sinon.assert.notCalled(page.createHook);
  });

  it('drops a target that the hook type ignores', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.createHook.resolves({
      hook: {id: 'hook-1', type: 'storage', action: 'log', persist: false},
      applied: true,
      detail: 'localStorage and sessionStorage are hooked',
    });
    page.getHooks.returns([]);

    await createHook(args).handler(
      {params: {type: 'storage', target: 'window.fetch'}, page},
      response,
      context,
    );

    sinon.assert.calledOnceWithExactly(page.createHook, {
      type: 'storage',
      action: 'log',
      persist: false,
    });
  });

  it('reports a persistent hook that is not active yet', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.createHook.resolves({
      hook: {...FUNCTION_HOOK, persist: true},
      applied: false,
      detail: 'window.fetch is not a function',
    });
    page.getHooks.returns([{...FUNCTION_HOOK, persist: true}]);

    await createHook(args).handler(
      {params: {type: 'function', target: 'window.fetch', persist: true}, page},
      response,
      context,
    );

    sinon.assert.calledWithExactly(
      response.appendResponseLine.secondCall,
      'The hook is not active in the current document: window.fetch is not a function. It is injected when the next document loads.',
    );
  });
});

describe('remove_hook', () => {
  it('removes one hook and lists the remaining hooks', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.removeHook.resolves([]);

    await removeHook(args).handler(
      {params: {hookId: 'hook-1'}, page},
      response,
      context,
    );

    sinon.assert.calledOnceWithExactly(page.removeHook, 'hook-1');
    sinon.assert.calledWithExactly(
      response.appendResponseLine.firstCall,
      'Hook hook-1 removed.',
    );
    sinon.assert.calledWithExactly(
      response.appendResponseLine.lastCall,
      'No hooks are registered for this page.',
    );
  });

  it('removes every hook when no id is given', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.removeHook.resolves([]);

    await removeHook(args).handler({params: {}, page}, response, context);

    sinon.assert.calledOnceWithExactly(page.removeHook, undefined);
    sinon.assert.calledWithExactly(
      response.appendResponseLine.firstCall,
      'All hooks removed.',
    );
  });
});
