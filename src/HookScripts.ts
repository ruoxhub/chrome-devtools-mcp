/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type HookType =
  'function' | 'object-method' | 'eval' | 'storage' | 'cookie';

export type HookAction = 'log' | 'block';

export interface HookOptions {
  type: HookType;
  /**
   * A dotted path to the hooked function or object member, for example
   * `window.fetch` or `JSON.stringify`. Required for the `function` and
   * `object-method` types and ignored by the others.
   */
  target?: string;
  /** Whether the hook only reports or also stops the operation. */
  action: HookAction;
  /** Page JavaScript that runs on every hooked call, before the original. */
  customCode?: string;
  /** Stops logging after this many calls. Used by the `function` type only. */
  maxCalls?: number;
  /** Logs at most once per this many milliseconds. `function` type only. */
  minInterval?: number;
  /**
   * Whether a script that cannot find its target yet keeps looking for it. Set
   * for a persistent hook, which runs at the start of a document, before the
   * scripts of the page define the target it hooks.
   */
  retry?: boolean;
}

/**
 * The result an injected hook script evaluates to. The script reports it
 * instead of throwing, so the caller learns whether the target was patched.
 */
export interface HookScriptResult {
  applied: boolean;
  detail: string;
}

const TARGET_PATTERN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/**
 * Builds the script the page runs to install a hook. The script is an
 * expression that evaluates to a {@link HookScriptResult}.
 */
export function generateHookScript(options: HookOptions): string {
  switch (options.type) {
    case 'function':
      return generateFunctionHook(options);
    case 'object-method':
      return generateObjectMethodHook(options);
    case 'eval':
      return generateEvalHook(options);
    case 'storage':
      return generateStorageHook(options);
    case 'cookie':
      return generateCookieHook(options);
  }
}

/** Reads the value {@link generateHookScript} produced in the page. */
export function readHookScriptResult(value: unknown): HookScriptResult {
  if (typeof value !== 'object' || value === null) {
    return {applied: false, detail: 'the hook script reported no status'};
  }
  const applied = 'applied' in value ? value.applied : undefined;
  const detail = 'detail' in value ? value.detail : undefined;
  return {
    applied: applied === true,
    detail:
      typeof detail === 'string'
        ? detail
        : 'the hook script reported no detail',
  };
}

/**
 * Wraps page code so that a failure to patch the page is reported instead of
 * leaving the page half modified with an exception the caller has to guess at.
 */
function wrap(body: string): string {
  return `(function () {
'use strict';
try {
${body}
} catch (error) {
  return {applied: false, detail: String((error && error.message) || error)};
}
})()`;
}

function requireTarget(options: HookOptions): string {
  const target = options.target;
  if (target === undefined || !TARGET_PATTERN.test(target)) {
    throw new Error(
      `Invalid hook target "${String(target)}". Expected a dotted path such as "window.fetch".`,
    );
  }
  return target;
}

/**
 * Splits a target into the expression that owns it and the member to patch. A
 * target without a dot belongs to `defaultOwner`, which lets a persistent hook
 * watch a global that the document defines later.
 */
function requireTargetParts(
  options: HookOptions,
  defaultOwner?: string,
): {
  target: string;
  owner: string;
  name: string;
} {
  const target = requireTarget(options);
  const separator = target.lastIndexOf('.');
  if (separator === -1) {
    if (defaultOwner === undefined) {
      throw new Error(
        `Invalid object-method target "${target}". Expected an object and a member, such as "JSON.stringify".`,
      );
    }
    return {target, owner: defaultOwner, name: target};
  }
  return {
    target,
    owner: target.slice(0, separator),
    name: target.slice(separator + 1),
  };
}

function customCode(options: HookOptions): string {
  return options.customCode === undefined ? '' : `\n${options.customCode}\n`;
}

/**
 * Wraps a hook body that needs its target to exist. A persistent script runs
 * before the scripts of the document, so the target it hooks may be defined
 * later; the body then runs again for a bounded time, and the last attempt
 * reports why the hook stayed inactive.
 */
function repeatUntilTargetExists(label: string, body: string): string {
  return `const attempt = function () {
${body}
};
let attempts = 0;
let result = attempt();
if (!result.applied) {
  const timer = setInterval(function () {
    attempts++;
    result = attempt();
    if (result.applied) {
      clearInterval(timer);
      return;
    }
    if (attempts < 100) {
      return;
    }
    clearInterval(timer);
    console.warn('[Hook] could not hook ${label}: ' + result.detail);
  }, 50);
}
return result;`;
}

function generateFunctionHook(options: HookOptions): string {
  const {target, owner, name} = requireTargetParts(options, 'window');
  const body =
    options.action === 'block'
      ? 'return undefined;'
      : `const returned = original.apply(this, arguments);
  if (report) {
    console.log('[Hook] ${target} returned', returned);
  }
  return returned;`;
  const install = `const container = ${owner};
if (container === undefined || container === null) {
  return {applied: false, detail: '${owner} does not exist yet'};
}
const original = container['${name}'];
if (typeof original !== 'function') {
  return {applied: false, detail: '${target} is not a function'};
}
let calls = 0;
let lastLogged = 0;
container['${name}'] = function () {
  const now = Date.now();
  calls++;
  const report = calls <= ${options.maxCalls ?? 'Infinity'} && now - lastLogged >= ${options.minInterval ?? 0};
  if (report) {
    lastLogged = now;
    console.log('[Hook] ${target} called', {arguments: Array.prototype.slice.call(arguments), stack: new Error().stack});
  }
${customCode(options)}  ${body}
};
return {applied: true, detail: '${target} is hooked'};`;
  return wrap(
    options.retry ? repeatUntilTargetExists(target, install) : install,
  );
}

function generateObjectMethodHook(options: HookOptions): string {
  const {target, owner, name} = requireTargetParts(options);
  const block = options.action === 'block';
  const call = block
    ? 'return undefined;'
    : `const returned = original.apply(this, arguments);
      console.log('[Hook] ${target} returned', returned);
      return returned;`;
  const write = block
    ? 'return;'
    : `if (originalSet) {
        originalSet.call(this, value);
      }`;
  const install = `const container = ${owner};
if (container === undefined || container === null) {
  return {applied: false, detail: '${owner} does not exist yet'};
}
const descriptor = Object.getOwnPropertyDescriptor(container, '${name}');
if (!descriptor) {
  return {applied: false, detail: '${target} is not an own property of ${owner}'};
}
if (typeof descriptor.value === 'function') {
  const original = descriptor.value;
  Object.defineProperty(container, '${name}', {
    value: function () {
      console.log('[Hook] ${target} called', {arguments: Array.prototype.slice.call(arguments), stack: new Error().stack});
${customCode(options)}      ${call}
    },
    writable: descriptor.writable,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
  });
  return {applied: true, detail: '${target} is hooked'};
}
if (descriptor.get || descriptor.set) {
  const originalGet = descriptor.get;
  const originalSet = descriptor.set;
  Object.defineProperty(container, '${name}', {
    get: function () {
      const value = originalGet ? originalGet.call(this) : undefined;
      console.log('[Hook] ${target} get', value);
      return value;
    },
    set: function (value) {
      console.log('[Hook] ${target} set', value);
${customCode(options)}      ${write}
    },
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
  });
  return {applied: true, detail: '${target} accessors are hooked'};
}
return {applied: false, detail: '${target} is neither a method nor an accessor'};`;
  return wrap(
    options.retry ? repeatUntilTargetExists(target, install) : install,
  );
}

function generateEvalHook(options: HookOptions): string {
  const block = options.action === 'block';
  const run = (label: string, call: string): string =>
    block
      ? `throw new Error('[Hook] ${label} is blocked');`
      : `return ${call};`;
  return wrap(`
const originalEval = window.eval;
window.eval = function (code) {
  console.log('[Hook] eval called', {code: code, stack: new Error().stack});
${customCode(options)}  ${run('eval', 'originalEval.apply(this, arguments)')}
};
const OriginalFunction = window.Function;
const hookedFunction = function () {
  console.log('[Hook] Function constructor called', {arguments: Array.prototype.slice.call(arguments), stack: new Error().stack});
${customCode(options)}  ${run('Function constructor', 'OriginalFunction.apply(this, arguments)')}
};
hookedFunction.prototype = OriginalFunction.prototype;
window.Function = hookedFunction;
['setTimeout', 'setInterval'].forEach(function (name) {
  const original = window[name];
  window[name] = function (handler) {
    if (typeof handler === 'string') {
      console.log('[Hook] ' + name + ' string handler', {code: handler, stack: new Error().stack});
    }
    return original.apply(this, arguments);
  };
});
return {applied: true, detail: 'eval, Function, setTimeout and setInterval are hooked'};`);
}

function generateStorageHook(options: HookOptions): string {
  const write = (original: string): string =>
    options.action === 'block'
      ? 'return undefined;'
      : `return ${original}.apply(this, arguments);`;
  return wrap(`
const proto = Storage.prototype;
const originalSetItem = proto.setItem;
const originalGetItem = proto.getItem;
const originalRemoveItem = proto.removeItem;
const originalClear = proto.clear;
function storeName(storage) {
  return storage === window.localStorage ? 'localStorage' : 'sessionStorage';
}
proto.setItem = function (key, value) {
  console.log('[Hook] ' + storeName(this) + '.setItem', {key: key, value: value, stack: new Error().stack});
${customCode(options)}  ${write('originalSetItem')}
};
proto.getItem = function (key) {
  const value = originalGetItem.apply(this, arguments);
  console.log('[Hook] ' + storeName(this) + '.getItem', {key: key, value: value});
  return value;
};
proto.removeItem = function (key) {
  console.log('[Hook] ' + storeName(this) + '.removeItem', {key: key, stack: new Error().stack});
${customCode(options)}  ${write('originalRemoveItem')}
};
proto.clear = function () {
  console.log('[Hook] ' + storeName(this) + '.clear', {});
${customCode(options)}  ${write('originalClear')}
};
return {applied: true, detail: 'localStorage and sessionStorage are hooked'};`);
}

function generateCookieHook(options: HookOptions): string {
  const write =
    options.action === 'block'
      ? 'return;'
      : 'return originalSet.call(this, value);';
  return wrap(`
const proto = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ? Document.prototype : HTMLDocument.prototype;
const descriptor = Object.getOwnPropertyDescriptor(proto, 'cookie');
if (!descriptor || !descriptor.get || !descriptor.set) {
  return {applied: false, detail: 'document.cookie is not an accessor in this document'};
}
const originalGet = descriptor.get;
const originalSet = descriptor.set;
Object.defineProperty(document, 'cookie', {
  enumerable: descriptor.enumerable,
  configurable: true,
  get: function () {
    const value = originalGet.call(this);
    console.log('[Hook] document.cookie read', value);
    return value;
  },
  set: function (value) {
    console.log('[Hook] document.cookie write', value);
${customCode(options)}    ${write}
  },
});
return {applied: true, detail: 'document.cookie is hooked'};`);
}
