/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  generateHookScript,
  readHookScriptResult,
  type HookAction,
  type HookOptions,
  type HookType,
} from './HookScripts.js';
import {type Page} from './third_party/index.js';
import {createIdGenerator} from './utils/id.js';

/** A hook registered for one page. */
export interface Hook {
  id: string;
  type: HookType;
  target?: string;
  action: HookAction;
  /** Whether the hook is injected again into every document loaded later. */
  persist: boolean;
}

export interface CreateHookOptions extends HookOptions {
  persist: boolean;
}

export interface HookInjection {
  hook: Hook;
  /** Whether the hook is active in the document that was current at creation. */
  applied: boolean;
  detail: string;
}

interface RegisteredHook {
  hook: Hook;
  /** The script {@link Page.evaluateOnNewDocument} returned, if persistent. */
  newDocumentScriptId?: string;
}

/**
 * Owns the hooks of one page. A hook is a script injected into the page that
 * reports one kind of page operation to the console.
 */
export class HookManager {
  #page: Page;
  #hooks: Map<string, RegisteredHook> = new Map();
  #nextId: () => number = createIdGenerator();

  constructor(page: Page) {
    this.#page = page;
  }

  getHooks(): Hook[] {
    return Array.from(this.#hooks.values(), registered => registered.hook);
  }

  /**
   * Injects a hook into the current document and, if it is persistent, into
   * every document loaded afterwards. Throws when a non-persistent hook does
   * not patch the current document, so a failed hook is never registered.
   */
  async createHook(options: CreateHookOptions): Promise<HookInjection> {
    // A persistent script runs before the scripts of a document, so the target
    // it hooks may not exist yet: keep looking for it instead of giving up.
    const script = generateHookScript({
      ...options,
      retry: options.persist,
    });
    const result = readHookScriptResult(await this.#page.evaluate(script));
    if (!result.applied && !options.persist) {
      throw new Error(`Failed to hook ${describe(options)}: ${result.detail}.`);
    }
    const hook: Hook = {
      id: `hook-${this.#nextId()}`,
      type: options.type,
      action: options.action,
      persist: options.persist,
    };
    if (options.target !== undefined) {
      hook.target = options.target;
    }
    const registered: RegisteredHook = {hook};
    if (options.persist) {
      const {identifier} = await this.#page.evaluateOnNewDocument(script);
      registered.newDocumentScriptId = identifier;
    }
    this.#hooks.set(hook.id, registered);
    return {...result, hook};
  }

  /**
   * Removes one hook, or all of them when `id` is omitted, and returns the
   * hooks that remain. A removed persistent hook is no longer injected into
   * documents loaded later; the patch of the current document stays.
   */
  async removeHook(id?: string): Promise<Hook[]> {
    const registered =
      id === undefined ? Array.from(this.#hooks.values()) : [this.#getHook(id)];
    for (const entry of registered) {
      await this.#unregister(entry);
      this.#hooks.delete(entry.hook.id);
    }
    return this.getHooks();
  }

  dispose(): void {
    for (const entry of this.#hooks.values()) {
      if (entry.newDocumentScriptId === undefined) {
        continue;
      }
      // The page is going away, so there is nothing left to report a failure to.
      void this.#page
        .removeScriptToEvaluateOnNewDocument(entry.newDocumentScriptId)
        .catch(() => {});
    }
    this.#hooks.clear();
  }

  #getHook(id: string): RegisteredHook {
    const registered = this.#hooks.get(id);
    if (!registered) {
      throw new Error(`Unknown hook: ${id}.`);
    }
    return registered;
  }

  async #unregister(entry: RegisteredHook): Promise<void> {
    if (entry.newDocumentScriptId === undefined) {
      return;
    }
    await this.#page.removeScriptToEvaluateOnNewDocument(
      entry.newDocumentScriptId,
    );
  }
}

function describe(options: HookOptions): string {
  return options.target === undefined
    ? `the ${options.type} operations`
    : options.target;
}
