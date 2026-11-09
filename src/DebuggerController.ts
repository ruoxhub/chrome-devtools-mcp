/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {TargetUniverse} from './devtools/DevtoolsUtils.js';
import {DevTools} from './third_party/index.js';

export interface DebuggerLocation {
  lineNumber: number;
  url?: string;
  scriptId?: string;
  columnNumber?: number;
}

export interface SetBreakpointOptions {
  lineNumber: number;
  url?: string;
  scriptId?: string;
  columnNumber?: number;
  condition?: string;
}

export interface BreakpointRecord {
  breakpointId: string;
  requested: DebuggerLocation;
  resolved: readonly DebuggerLocation[];
  bound: boolean;
  condition?: string;
}

interface RawLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

interface ProtocolResponse {
  getError(): string | undefined;
}

interface SetByUrlResponse extends ProtocolResponse {
  breakpointId: string;
  locations: RawLocation[];
}

interface SetByScriptResponse extends ProtocolResponse {
  breakpointId: string;
  actualLocation: RawLocation;
}

interface SetByUrlRequest {
  lineNumber: number;
  url: string;
  columnNumber?: number;
  condition?: string;
}

interface SetByScriptRequest {
  location: RawLocation;
  condition?: string;
}

interface DebuggerAgentLike {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_setBreakpointByUrl(params: SetByUrlRequest): Promise<SetByUrlResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_setBreakpoint(
    params: SetByScriptRequest,
  ): Promise<SetByScriptResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_removeBreakpoint(params: {
    breakpointId: string;
  }): Promise<ProtocolResponse>;
}

const PAUSED_EVENT = 'Debugger.paused';
const RESUMED_EVENT = 'Debugger.resumed';

function toToolLocation(location: RawLocation): DebuggerLocation {
  const result: DebuggerLocation = {
    lineNumber: location.lineNumber + 1,
  };
  if (location.scriptId !== '') {
    result.scriptId = location.scriptId;
  }
  if (location.columnNumber !== undefined) {
    result.columnNumber = location.columnNumber + 1;
  }
  return result;
}

export class DebuggerController {
  readonly #session: TargetUniverse['session'];
  readonly #setting: DevTools.Common.Settings.Setting<boolean>;
  readonly #agent: DebuggerAgentLike;
  readonly #breakpoints = new Map<string, BreakpointRecord>();
  readonly #pausedListener = (): void => {};
  readonly #resumedListener = (): void => {};
  #enabled = false;
  #disposed = false;

  constructor(devtools: TargetUniverse) {
    this.#session = devtools.session;
    this.#setting = devtools.universe.settings.resolve(
      DevTools.skipAllPausesSettingDescriptor,
    );
    const model = devtools.target.model(DevTools.DebuggerModel);
    if (!model) {
      throw new Error('The DevTools debugger model is not available.');
    }
    this.#agent = model.agent;
  }

  enable(): void {
    if (this.#enabled || this.#disposed) {
      return;
    }
    this.#enabled = true;
    this.#setting.set(false);
    this.#session.on(PAUSED_EVENT, this.#pausedListener);
    this.#session.on(RESUMED_EVENT, this.#resumedListener);
  }

  disable(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#enabled) {
      this.#enabled = false;
      this.#session.off(PAUSED_EVENT, this.#pausedListener);
      this.#session.off(RESUMED_EVENT, this.#resumedListener);
    }
    this.#setting.set(true);
    this.#removeOwnBreakpoints();
  }

  async setBreakpoint(
    options: SetBreakpointOptions,
  ): Promise<BreakpointRecord> {
    const {url, scriptId, lineNumber, columnNumber, condition} = options;
    const hasOneSource = (url === undefined) !== (scriptId === undefined);
    if (
      lineNumber < 1 ||
      !hasOneSource ||
      (columnNumber !== undefined && columnNumber < 1)
    ) {
      throw new Error(
        `Invalid breakpoint: lineNumber=${lineNumber}, columnNumber=${columnNumber ?? 'omitted'}, url=${url ?? 'omitted'}, scriptId=${scriptId ?? 'omitted'}. Provide a 1-based lineNumber and exactly one of url or scriptId.`,
      );
    }
    const cdpLineNumber = lineNumber - 1;
    const cdpColumnNumber =
      columnNumber === undefined ? undefined : columnNumber - 1;
    const requested: DebuggerLocation = {lineNumber};
    if (url !== undefined) {
      requested.url = url;
    }
    if (scriptId !== undefined) {
      requested.scriptId = scriptId;
    }
    if (columnNumber !== undefined) {
      requested.columnNumber = columnNumber;
    }
    let breakpointId: string;
    let resolved: DebuggerLocation[];
    if (url !== undefined) {
      const request: SetByUrlRequest = {lineNumber: cdpLineNumber, url};
      if (cdpColumnNumber !== undefined) {
        request.columnNumber = cdpColumnNumber;
      }
      if (condition !== undefined) {
        request.condition = condition;
      }
      const response = await this.#agent.invoke_setBreakpointByUrl(request);
      const error = response.getError();
      if (error) {
        throw new Error(`Failed to set breakpoint: ${error}`);
      }
      breakpointId = response.breakpointId;
      resolved = response.locations.map(toToolLocation);
    } else if (scriptId !== undefined) {
      const location: RawLocation = {
        scriptId,
        lineNumber: cdpLineNumber,
      };
      if (cdpColumnNumber !== undefined) {
        location.columnNumber = cdpColumnNumber;
      }
      const request: SetByScriptRequest = {location};
      if (condition !== undefined) {
        request.condition = condition;
      }
      const response = await this.#agent.invoke_setBreakpoint(request);
      const error = response.getError();
      if (error) {
        throw new Error(`Failed to set breakpoint: ${error}`);
      }
      breakpointId = response.breakpointId;
      resolved = [toToolLocation(response.actualLocation)];
    } else {
      throw new Error('A breakpoint requires exactly one of url or scriptId.');
    }
    const record: BreakpointRecord = {
      breakpointId,
      requested,
      resolved,
      bound: resolved.length > 0,
    };
    if (condition !== undefined) {
      record.condition = condition;
    }
    this.#breakpoints.set(breakpointId, record);
    return record;
  }

  listBreakpoints(): readonly BreakpointRecord[] {
    return [...this.#breakpoints.values()];
  }

  async removeBreakpoint(breakpointId: string): Promise<boolean> {
    if (!this.#breakpoints.has(breakpointId)) {
      return false;
    }
    const response = await this.#agent.invoke_removeBreakpoint({breakpointId});
    const error = response.getError();
    if (error) {
      throw new Error(`Failed to remove breakpoint ${breakpointId}: ${error}`);
    }
    this.#breakpoints.delete(breakpointId);
    return true;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.disable();
    this.#disposed = true;
  }

  #removeOwnBreakpoints(): void {
    const breakpointIds = [...this.#breakpoints.keys()];
    this.#breakpoints.clear();
    for (const breakpointId of breakpointIds) {
      void this.#agent
        .invoke_removeBreakpoint({breakpointId})
        .catch(() => undefined);
    }
  }
}
