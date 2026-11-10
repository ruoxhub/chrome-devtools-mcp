/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';
import {createContext, Script} from 'node:vm';

import {
  generateHookScript,
  readHookScriptResult,
  type HookOptions,
  type HookScriptResult,
} from '../src/HookScripts.js';

const FUNCTION_HOOK: HookOptions = {
  type: 'function',
  target: 'window.fetch',
  action: 'log',
};

/**
 * Runs a generated script the way the page would, in a context that only has
 * the properties of `page` plus a console whose output is collected. Timers are
 * fake, so a test drives the retries of a hook that waits for its target.
 */
function runInPage(
  script: string,
  page: object,
): {
  result: HookScriptResult;
  logs: unknown[][];
  tick: (times: number) => void;
} {
  const logs: unknown[][] = [];
  const intervals = new Map<number, () => void>();
  let nextTimerId = 1;
  let ticks = 0;
  const context = createContext({
    window: page,
    console: {
      log: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
    },
    setInterval: (callback: () => void) => {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
  });
  const value = new Script(script).runInContext(context);
  return {
    result: readHookScriptResult(value),
    logs,
    tick: (times: number) => {
      for (; ticks < times; ticks++) {
        for (const callback of [...intervals.values()]) {
          callback();
        }
      }
    },
  };
}

describe('generateHookScript', () => {
  it('generates a script that parses for every hook type', () => {
    const options: HookOptions[] = [
      FUNCTION_HOOK,
      {type: 'object-method', target: 'JSON.stringify', action: 'log'},
      {type: 'eval', action: 'block'},
      {type: 'storage', action: 'log'},
      {type: 'cookie', action: 'block'},
    ];
    for (const option of options) {
      assert.doesNotThrow(() => new Script(generateHookScript(option)));
    }
  });

  it('requires a valid target for the target-based types', () => {
    assert.throws(
      () => generateHookScript({type: 'function', action: 'log'}),
      /Invalid hook target "undefined"/,
    );
    assert.throws(
      () =>
        generateHookScript({
          type: 'object-method',
          target: 'JSON',
          action: 'log',
        }),
      /Expected an object and a member/,
    );
  });

  it('hooks a function and returns its value', () => {
    const page = {fetch: (input: string) => `fetched ${input}`};
    const {result} = runInPage(generateHookScript(FUNCTION_HOOK), page);

    assert.deepStrictEqual(result, {
      applied: true,
      detail: 'window.fetch is hooked',
    });
    assert.strictEqual(page.fetch('a'), 'fetched a');
  });

  it('hooks a function the page defines after the script ran', () => {
    const page: {fetch?: (input: string) => string} = {};
    const {result, logs, tick} = runInPage(
      generateHookScript({...FUNCTION_HOOK, retry: true}),
      page,
    );

    assert.deepStrictEqual(result, {
      applied: false,
      detail: 'window.fetch is not a function',
    });

    page.fetch = (input: string) => `fetched ${input}`;
    tick(1);
    assert.strictEqual(page.fetch('a'), 'fetched a');
    assert.deepStrictEqual(
      logs.map(args => args[0]),
      ['[Hook] window.fetch called', '[Hook] window.fetch returned'],
    );
  });

  it('gives up and warns when the target never appears', () => {
    const {result, logs, tick} = runInPage(
      generateHookScript({...FUNCTION_HOOK, retry: true}),
      {},
    );

    assert.strictEqual(result.applied, false);
    tick(100);
    tick(1);
    assert.deepStrictEqual(logs.at(-1), [
      '[Hook] could not hook window.fetch: window.fetch is not a function',
    ]);
  });

  it('blocks a function without calling it', () => {
    const calls: string[] = [];
    const page = {
      fetch: (input: string) => {
        calls.push(input);
        return 'fetched';
      },
    };
    const {result} = runInPage(
      generateHookScript({...FUNCTION_HOOK, action: 'block'}),
      page,
    );

    assert.strictEqual(result.applied, true);
    assert.strictEqual(page.fetch('a'), undefined);
    assert.deepStrictEqual(calls, []);
  });

  it('stops logging after maxCalls but keeps calling the function', () => {
    const page = {fetch: (input: string) => `fetched ${input}`};
    const {result, logs} = runInPage(
      generateHookScript({...FUNCTION_HOOK, maxCalls: 1}),
      page,
    );

    assert.strictEqual(result.applied, true);
    page.fetch('a');
    page.fetch('b');
    assert.deepStrictEqual(
      logs.map(args => args[0]),
      ['[Hook] window.fetch called', '[Hook] window.fetch returned'],
    );
  });

  it('reports a target that is not a function', () => {
    const {result} = runInPage(generateHookScript(FUNCTION_HOOK), {});

    assert.deepStrictEqual(result, {
      applied: false,
      detail: 'window.fetch is not a function',
    });
  });

  it('runs custom code on every hooked call', () => {
    const page = {fetch: (input: string) => input};
    const {result} = runInPage(
      generateHookScript({
        ...FUNCTION_HOOK,
        customCode: 'console.log("custom", arguments[0]);',
      }),
      page,
    );

    assert.strictEqual(result.applied, true);
    page.fetch('a');
  });

  it('hooks an object method', () => {
    const page = {JSON: {stringify: (value: unknown) => `saved ${value}`}};
    const {result} = runInPage(
      generateHookScript({
        type: 'object-method',
        target: 'window.JSON.stringify',
        action: 'log',
      }),
      page,
    );

    assert.strictEqual(result.applied, true);
    assert.strictEqual(page.JSON.stringify('a'), 'saved a');
  });

  it('hooks an object accessor', () => {
    let stored = 'initial';
    const page = {
      store: {
        get value() {
          return stored;
        },
        set value(next: string) {
          stored = next;
        },
      },
    };
    const {result} = runInPage(
      generateHookScript({
        type: 'object-method',
        target: 'window.store.value',
        action: 'block',
      }),
      page,
    );

    assert.strictEqual(result.applied, true);
    page.store.value = 'blocked';
    assert.strictEqual(page.store.value, 'initial');
  });

  it('reports an object member that does not exist', () => {
    const {result} = runInPage(
      generateHookScript({
        type: 'object-method',
        target: 'window.JSON.missing',
        action: 'log',
      }),
      {JSON: {}},
    );

    assert.strictEqual(result.applied, false);
    assert.match(result.detail, /is not an own property of window\.JSON/);
  });

  it('blocks eval and the Function constructor', () => {
    const script = generateHookScript({type: 'eval', action: 'block'});

    assert.match(script, /throw new Error\('\[Hook\] eval is blocked'\)/);
    assert.match(
      script,
      /throw new Error\('\[Hook\] Function constructor is blocked'\)/,
    );
  });

  it('hides no hook type from the console output', () => {
    const scripts = [
      generateHookScript(FUNCTION_HOOK),
      generateHookScript({
        type: 'object-method',
        target: 'JSON.stringify',
        action: 'log',
      }),
      generateHookScript({type: 'eval', action: 'log'}),
      generateHookScript({type: 'storage', action: 'log'}),
      generateHookScript({type: 'cookie', action: 'log'}),
    ];
    for (const script of scripts) {
      assert.match(script, /console\.log\('\[Hook\]/);
      assert.match(script, /'\[Hook\]/);
    }
  });
});

describe('readHookScriptResult', () => {
  it('reads the status the script reported', () => {
    assert.deepStrictEqual(
      readHookScriptResult({applied: true, detail: 'hooked'}),
      {applied: true, detail: 'hooked'},
    );
  });

  it('treats anything else as not applied', () => {
    assert.deepStrictEqual(readHookScriptResult(undefined), {
      applied: false,
      detail: 'the hook script reported no status',
    });
    assert.deepStrictEqual(readHookScriptResult(null), {
      applied: false,
      detail: 'the hook script reported no status',
    });
    assert.deepStrictEqual(readHookScriptResult({applied: 'yes'}), {
      applied: false,
      detail: 'the hook script reported no detail',
    });
  });
});
