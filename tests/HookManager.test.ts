/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {HookManager} from '../src/HookManager.js';
import {createMockPuppeteerPage} from './mocks.js';

function applied(detail = 'window.fetch is hooked'): {
  applied: boolean;
  detail: string;
} {
  return {applied: true, detail};
}

describe('HookManager', () => {
  it('injects a hook into the current document only by default', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves(applied());
    const manager = new HookManager(pptrPage);

    const {hook, applied: isApplied} = await manager.createHook({
      type: 'function',
      target: 'window.fetch',
      action: 'log',
      persist: false,
    });

    assert.deepStrictEqual(hook, {
      id: 'hook-1',
      type: 'function',
      target: 'window.fetch',
      action: 'log',
      persist: false,
    });
    assert.strictEqual(isApplied, true);
    sinon.assert.calledOnce(pptrPage.evaluate);
    sinon.assert.notCalled(pptrPage.evaluateOnNewDocument);
  });

  it('registers a persistent hook for every new document', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves(applied());
    pptrPage.evaluateOnNewDocument.resolves({identifier: 'script-1'});
    const manager = new HookManager(pptrPage);

    await manager.createHook({
      type: 'storage',
      action: 'log',
      persist: true,
    });

    sinon.assert.calledOnce(pptrPage.evaluate);
    sinon.assert.calledOnce(pptrPage.evaluateOnNewDocument);
    assert.strictEqual(
      pptrPage.evaluateOnNewDocument.firstCall.args[0],
      pptrPage.evaluate.firstCall.args[0],
    );
  });

  it('throws instead of registering a hook that did not patch the page', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves({
      applied: false,
      detail: 'window.fetch is not a function',
    });
    const manager = new HookManager(pptrPage);

    await assert.rejects(
      manager.createHook({
        type: 'function',
        target: 'window.fetch',
        action: 'log',
        persist: false,
      }),
      /Failed to hook window\.fetch: window\.fetch is not a function\./,
    );
    assert.deepStrictEqual(manager.getHooks(), []);
  });

  it('registers a persistent hook that is not active in the current document', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves({
      applied: false,
      detail: 'document.cookie is not an accessor in this document',
    });
    pptrPage.evaluateOnNewDocument.resolves({identifier: 'script-1'});
    const manager = new HookManager(pptrPage);

    const result = await manager.createHook({
      type: 'cookie',
      action: 'log',
      persist: true,
    });

    assert.strictEqual(result.applied, false);
    assert.deepStrictEqual(manager.getHooks(), [result.hook]);
  });

  it('removes one hook and unregisters it from new documents', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves(applied());
    pptrPage.evaluateOnNewDocument.resolves({identifier: 'script-1'});
    const manager = new HookManager(pptrPage);
    const first = await manager.createHook({
      type: 'function',
      target: 'window.fetch',
      action: 'log',
      persist: true,
    });
    const second = await manager.createHook({
      type: 'eval',
      action: 'log',
      persist: false,
    });

    const remaining = await manager.removeHook(first.hook.id);

    sinon.assert.calledOnceWithExactly(
      pptrPage.removeScriptToEvaluateOnNewDocument,
      'script-1',
    );
    assert.deepStrictEqual(remaining, [second.hook]);
  });

  it('removes every hook when no id is given', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves(applied());
    pptrPage.evaluateOnNewDocument.resolves({identifier: 'script-1'});
    const manager = new HookManager(pptrPage);
    await manager.createHook({
      type: 'function',
      target: 'window.fetch',
      action: 'log',
      persist: true,
    });
    await manager.createHook({type: 'eval', action: 'log', persist: false});

    const remaining = await manager.removeHook();

    assert.deepStrictEqual(remaining, []);
    sinon.assert.calledOnceWithExactly(
      pptrPage.removeScriptToEvaluateOnNewDocument,
      'script-1',
    );
  });

  it('rejects an unknown hook id', async () => {
    const manager = new HookManager(createMockPuppeteerPage());

    await assert.rejects(
      manager.removeHook('hook-99'),
      /Unknown hook: hook-99\./,
    );
  });

  it('unregisters every persistent hook on dispose', async () => {
    const pptrPage = createMockPuppeteerPage();
    pptrPage.evaluate.resolves(applied());
    pptrPage.evaluateOnNewDocument.resolves({identifier: 'script-1'});
    pptrPage.removeScriptToEvaluateOnNewDocument.resolves();
    const manager = new HookManager(pptrPage);
    await manager.createHook({
      type: 'function',
      target: 'window.fetch',
      action: 'log',
      persist: true,
    });

    manager.dispose();

    assert.deepStrictEqual(manager.getHooks(), []);
    sinon.assert.calledOnceWithExactly(
      pptrPage.removeScriptToEvaluateOnNewDocument,
      'script-1',
    );
  });
});
