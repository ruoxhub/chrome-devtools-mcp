/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CreateHookOptions, Hook} from '../HookManager.js';
import type {HookType} from '../HookScripts.js';
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {definePageTool, type PageToolFactory} from './ToolDefinition.js';
import {LIST_CONSOLE_MESSAGES_TOOL_NAME} from './toolNames.js';

const CREATE_HOOK_TOOL_NAME = 'create_hook';

export const createHook: PageToolFactory = definePageTool(() => ({
  name: CREATE_HOOK_TOOL_NAME,
  description: `Injects a script into the selected page that reports or stops one kind of page operation. Every hooked call is logged with console.log in the page; read the output with ${LIST_CONSOLE_MESSAGES_TOOL_NAME}. The hook stays registered for the page until remove_hook is called or the page is closed.

Types:
- "function": patches a global function or method given by an assignable dotted path, for example "window.fetch" or "app.save". Reports the arguments, the stack and the result of every call.
- "object-method": patches a method, or a getter and setter, of an object given by a dotted path, for example "JSON.stringify". The object must own the member; an inherited member is not found.
- "eval": patches eval, the Function constructor, and the string handlers of setTimeout and setInterval.
- "storage": patches localStorage and sessionStorage reads and writes.
- "cookie": patches document.cookie reads and writes.

With action "log" the page keeps working unchanged. With action "block" the hooked operation is stopped: a function or method returns undefined without being called, a storage or cookie write is dropped, and eval and the Function constructor throw.

A hook applies to the current document, and is lost on navigation or reload unless persist is true.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
    conditions: ['javascriptEvaluation'],
  },
  schema: {
    type: zod
      .enum(['function', 'object-method', 'eval', 'storage', 'cookie'])
      .describe('The kind of page operation to hook.'),
    target: zod
      .string()
      .regex(
        /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/,
        'Expected a dotted path such as "window.fetch" or "JSON.stringify".',
      )
      .optional()
      .describe(
        'Dotted path to the hooked function or object member, for example "window.fetch" or "JSON.stringify". Required for the "function" and "object-method" types and ignored by the others.',
      ),
    action: zod
      .enum(['log', 'block'])
      .optional()
      .describe(
        'What the hook does with the hooked operation. "log" only reports it. "block" stops it: the function is not called, the storage or cookie write is dropped, and eval and the Function constructor throw. Defaults to "log".',
      ),
    customCode: zod
      .string()
      .optional()
      .describe(
        'JavaScript that runs in the page inside the hook on every hooked call, before the original operation, and with the same arguments. It can change the arguments or throw to skip that one call. Used by the "function", "object-method" and "eval" types and by the storage and cookie writes; ignored by storage and cookie reads.',
      ),
    maxCalls: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Stops logging after this many calls. Only used by the "function" type and ignored by the others.',
      ),
    minInterval: zod
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Logs at most once per this many milliseconds. Only used by the "function" type and ignored by the others.',
      ),
    persist: zod
      .boolean()
      .optional()
      .describe(
        'Whether the hook is injected again into every document loaded afterwards, so it survives navigation and reload. The hook is applied to the current document either way. Defaults to false.',
      ),
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const {type, target} = request.params;
    requireTarget(type, target);
    const options: CreateHookOptions = {
      type,
      action: request.params.action ?? 'log',
      persist: request.params.persist ?? false,
    };
    if (type === 'function' || type === 'object-method') {
      options.target = target;
    }
    if (request.params.customCode !== undefined) {
      options.customCode = request.params.customCode;
    }
    if (request.params.maxCalls !== undefined) {
      options.maxCalls = request.params.maxCalls;
    }
    if (request.params.minInterval !== undefined) {
      options.minInterval = request.params.minInterval;
    }

    const {hook, applied, detail} = await request.page.createHook(options);
    const hooked =
      hook.target === undefined ? hook.type : `${hook.type} ${hook.target}`;
    response.appendResponseLine(
      `Created ${hook.id}: ${hooked}, action: ${hook.action}, ${
        hook.persist
          ? 'injected into every document loaded later'
          : 'current document only'
      }.`,
    );
    response.appendResponseLine(
      applied
        ? 'The hook is active in the current document.'
        : `The hook is not active in the current document: ${detail}. It is injected when the next document loads.`,
    );
    response.appendResponseLine(
      `Hooked operations report to console.log; read them with ${LIST_CONSOLE_MESSAGES_TOOL_NAME}.`,
    );
    response.appendResponseLine(formatHooks(request.page.getHooks()));
  },
}));

export const removeHook: PageToolFactory = definePageTool(() => ({
  name: 'remove_hook',
  description: `Removes a hook created with ${CREATE_HOOK_TOOL_NAME}, or every hook of the page when hookId is omitted, and lists the hooks that remain. Removing a hook stops it from being injected into documents loaded later; the patch already installed in the current document stays until the page navigates or reloads, and output it already logged stays in the console.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe(
        'The id of the hook to remove, as reported by create_hook. All hooks of the page are removed when omitted.',
      ),
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const hooks = await request.page.removeHook(request.params.hookId);
    const removed =
      request.params.hookId === undefined
        ? 'All hooks'
        : `Hook ${request.params.hookId}`;
    response.appendResponseLine(`${removed} removed.`);
    response.appendResponseLine(formatHooks(hooks));
  },
}));

/**
 * A target is only used by the types that patch a named function or member, so
 * the requirement cannot be expressed in the per-field schema.
 */
function requireTarget(type: HookType, target: string | undefined): void {
  if (type !== 'function' && type !== 'object-method') {
    return;
  }
  if (target === undefined) {
    throw new Error(
      `The "${type}" hook type requires a target, for example "window.fetch".`,
    );
  }
  if (type === 'object-method' && !target.includes('.')) {
    throw new Error(
      `The "object-method" hook type requires a target with an object prefix, for example "JSON.stringify".`,
    );
  }
}

function formatHooks(hooks: Hook[]): string {
  if (hooks.length === 0) {
    return 'No hooks are registered for this page.';
  }
  const list = hooks.map(hook => {
    const label =
      hook.target === undefined ? hook.type : `${hook.type} ${hook.target}`;
    return hook.persist
      ? `${hook.id} (${label}, persistent)`
      : `${hook.id} (${label})`;
  });
  return `Hooks on this page: ${list.join(', ')}.`;
}
