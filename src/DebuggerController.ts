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

export interface ScopeSummary {
  type: string;
  objectId?: string;
}

export interface CallFrameSnapshot {
  callFrameId: string;
  functionName: string;
  url: string;
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
  scopeChain?: readonly ScopeSummary[];
}

export interface PausedSnapshot {
  generation: number;
  paused: true;
  reason: string;
  hitBreakpoints: readonly string[];
  callFrames: readonly CallFrameSnapshot[];
}

export interface PausedStateView {
  generation: number;
  paused: boolean;
  reason?: string;
  hitBreakpoints: readonly string[];
  callFrames: readonly CallFrameSnapshot[];
}

export interface PauseResult {
  status: 'paused';
  snapshot: PausedStateView;
}

export interface PendingPauseResult {
  status: 'pending';
  generation: number;
}

export interface RemoteObjectLike {
  type: string;
  objectId?: string;
  description?: string;
  value?: string | number | boolean | null;
}

export interface EvaluationResultLike {
  result: RemoteObjectLike;
  exceptionDetails?: {text: string};
}

export interface EvaluateOnCallFrameOptions {
  callFrameId: string;
  expression: string;
  objectGroup?: string;
  returnByValue?: boolean;
  generatePreview?: boolean;
  throwOnSideEffect?: boolean;
  timeout?: number;
  scopeNumber?: number;
}

export interface GetObjectPropertiesOptions {
  objectId: string;
  ownProperties?: boolean;
  generatePreview?: boolean;
  maxProperties?: number;
  depth?: number;
}

export interface ObjectPropertyView {
  name: string;
  value?: RemoteObjectLike;
}

export interface ObjectPropertiesView {
  objectId: string;
  generation: number;
  properties: readonly ObjectPropertyView[];
  truncated: boolean;
  depth: number;
}

export interface ScopeLike {
  type: string;
  object: RemoteObjectLike;
}

export interface CallFrameLike {
  callFrameId: string;
  functionName: string;
  url: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
  };
  scopeChain: readonly ScopeLike[];
}

export interface PausedEventLike {
  reason: string;
  hitBreakpoints?: readonly string[];
  callFrames: readonly CallFrameLike[];
}

interface RawLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

interface CdpSessionLike {
  on<Key extends string>(
    event: Key,
    listener: (event: unknown) => void,
  ): unknown;
  off<Key extends string>(
    event: Key,
    listener: (event: unknown) => void,
  ): unknown;
  send(
    method: 'Runtime.getProperties',
    params: {
      objectId: string;
      ownProperties?: boolean;
      generatePreview?: boolean;
    },
  ): Promise<CdpGetPropertiesResponse>;
}

interface CdpGetPropertiesResponse {
  result: readonly ObjectPropertyView[];
  exceptionDetails?: {text: string};
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

interface EvaluateOnCallFrameRequest {
  callFrameId: string;
  expression: string;
  objectGroup?: string;
  returnByValue?: boolean;
  generatePreview?: boolean;
  throwOnSideEffect?: boolean;
  timeout?: number;
  scopeNumber?: number;
}

interface EvaluateOnCallFrameResponse extends ProtocolResponse {
  result: RemoteObjectLike;
  exceptionDetails?: {text: string};
}

interface Waiter {
  resolve(snapshot: PausedSnapshot): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  afterGeneration?: number;
  settled: boolean;
}

function validateTimeout(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      `Invalid pause timeout=${timeout}; expected a positive number.`,
    );
  }
  if (timeout > MAX_WAIT_TIMEOUT) {
    throw new Error(
      `Invalid pause timeout=${timeout}; exceeds maximum ${MAX_WAIT_TIMEOUT}ms.`,
    );
  }
  return timeout;
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
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_pause(): Promise<ProtocolResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_resume(params: {
    terminateOnResume: boolean;
  }): Promise<ProtocolResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_stepInto(params: {
    breakOnAsyncCall: boolean;
  }): Promise<ProtocolResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_stepOver(params: {skipList?: never}): Promise<ProtocolResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_stepOut(): Promise<ProtocolResponse>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_evaluateOnCallFrame(
    params: EvaluateOnCallFrameRequest,
  ): Promise<EvaluateOnCallFrameResponse>;
}

const PAUSED_EVENT = 'Debugger.paused';
const RESUMED_EVENT = 'Debugger.resumed';
export const DEFAULT_WAIT_TIMEOUT = 10_000;
export const MAX_WAIT_TIMEOUT = 30_000;

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

function toCallFrameSnapshot(
  frame: CallFrameLike,
  includeScopes: boolean,
): CallFrameSnapshot {
  const snapshot: CallFrameSnapshot = {
    callFrameId: frame.callFrameId,
    functionName: frame.functionName,
    url: frame.url,
    scriptId: frame.location.scriptId,
    lineNumber: frame.location.lineNumber + 1,
    columnNumber: (frame.location.columnNumber ?? 0) + 1,
  };
  if (includeScopes) {
    const scopes: ScopeSummary[] = [];
    for (const scope of frame.scopeChain) {
      const summary: ScopeSummary = {type: scope.type};
      if (scope.object.objectId !== undefined) {
        summary.objectId = scope.object.objectId;
      }
      scopes.push(summary);
    }
    snapshot.scopeChain = scopes;
  }
  return snapshot;
}

function toPausedSnapshot(
  generation: number,
  event: PausedEventLike,
  includeScopes: boolean,
): PausedSnapshot {
  return {
    generation,
    paused: true,
    reason: event.reason,
    hitBreakpoints: [...(event.hitBreakpoints ?? [])],
    callFrames: event.callFrames.map(frame =>
      toCallFrameSnapshot(frame, includeScopes),
    ),
  };
}

function toPausedEvent(value: unknown): PausedEventLike {
  if (!isRecord(value) || typeof value.reason !== 'string') {
    throw new Error('Invalid Debugger.paused event.');
  }
  const framesValue = value.callFrames;
  if (!Array.isArray(framesValue)) {
    throw new Error('Invalid Debugger.paused event.');
  }
  const callFrames: CallFrameLike[] = [];
  for (const frame of framesValue) {
    callFrames.push(toCallFrameEvent(frame));
  }
  const event: PausedEventLike = {reason: value.reason, callFrames};
  if (Array.isArray(value.hitBreakpoints)) {
    event.hitBreakpoints = value.hitBreakpoints.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toCallFrameEvent(value: unknown): CallFrameLike {
  if (
    !isRecord(value) ||
    typeof value.callFrameId !== 'string' ||
    typeof value.functionName !== 'string' ||
    typeof value.url !== 'string' ||
    !isRecord(value.location) ||
    typeof value.location.scriptId !== 'string' ||
    typeof value.location.lineNumber !== 'number' ||
    !Array.isArray(value.scopeChain)
  ) {
    throw new Error('Invalid Debugger.paused call frame.');
  }
  const location: CallFrameLike['location'] = {
    scriptId: value.location.scriptId,
    lineNumber: value.location.lineNumber,
  };
  if (typeof value.location.columnNumber === 'number') {
    location.columnNumber = value.location.columnNumber;
  }
  const scopeChain: ScopeLike[] = [];
  for (const scope of value.scopeChain) {
    scopeChain.push(toScopeEvent(scope));
  }
  return {
    callFrameId: value.callFrameId,
    functionName: value.functionName,
    url: value.url,
    location,
    scopeChain,
  };
}

function toScopeEvent(value: unknown): ScopeLike {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !isRecord(value.object) ||
    typeof value.object.type !== 'string'
  ) {
    throw new Error('Invalid Debugger.paused scope.');
  }
  const object: RemoteObjectLike = {type: value.object.type};
  if ('objectId' in value.object && typeof value.object.objectId === 'string') {
    object.objectId = value.object.objectId;
  }
  return {type: value.type, object};
}

export class DebuggerController {
  readonly #session: CdpSessionLike;
  readonly #setting: DevTools.Common.Settings.Setting<boolean>;
  readonly #agent: DebuggerAgentLike;
  readonly #breakpoints = new Map<string, BreakpointRecord>();
  readonly #waiters = new Set<Waiter>();
  readonly #pausedListener = (event: unknown): void => {
    const pausedEvent = toPausedEvent(event);
    this.#generation += 1;
    const snapshot = toPausedSnapshot(this.#generation, pausedEvent, true);
    this.#paused = snapshot;
    for (const waiter of this.#waiters) {
      if (snapshot.generation <= (waiter.afterGeneration ?? 0)) {
        continue;
      }
      this.#settleWaiter(waiter, snapshot);
    }
  };
  readonly #resumedListener = (): void => {
    this.#paused = undefined;
  };
  #generation = 0;
  #paused: PausedSnapshot | undefined;
  #enabled = false;
  #disposed = false;
  #disposeWaiterReason = 'Debug Session was disabled.';

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
    if (this.#disposeWaiterReason !== '') {
      this.#rejectWaiters(this.#disposeWaiterReason);
    }
    if (this.#paused) {
      void this.#agent
        .invoke_resume({terminateOnResume: false})
        .catch(() => undefined);
    }
    this.#paused = undefined;
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

  invalidatePausedState(): void {
    this.#paused = undefined;
  }

  waitForPaused(options?: {timeout?: number}): Promise<PausedSnapshot> {
    return this.#addWaiter(options, undefined);
  }

  async pause(options?: {
    timeout?: number;
  }): Promise<PauseResult | PendingPauseResult> {
    const generation = this.#generation;
    const waiting = this.#addWaiter(options, generation);
    const response = await this.#agent.invoke_pause();
    const error = response.getError();
    if (error) {
      waiting.catch(() => undefined);
      throw new Error(`Failed to pause: ${error}`);
    }
    try {
      const snapshot = this.#pausedAfter(generation) ?? (await waiting);
      return {
        status: 'paused',
        snapshot: this.#toPausedStateView(snapshot, false),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith('Timed out waiting for a pause after ')) {
        throw error;
      }
      return {status: 'pending', generation: this.#generation};
    }
  }

  async step(
    direction: 'into' | 'over' | 'out',
    options?: {timeout?: number},
  ): Promise<PauseResult> {
    const paused = this.#paused;
    if (!paused) {
      throw new Error('Cannot step while the page is not paused.');
    }
    const generation = paused.generation;
    const waiting = this.#addWaiter(options, generation);
    this.#paused = undefined;
    let response: ProtocolResponse;
    switch (direction) {
      case 'into':
        response = await this.#agent.invoke_stepInto({
          breakOnAsyncCall: false,
        });
        break;
      case 'over':
        response = await this.#agent.invoke_stepOver({});
        break;
      case 'out':
        response = await this.#agent.invoke_stepOut();
        break;
    }
    const error = response.getError();
    if (error) {
      waiting.catch(() => undefined);
      throw new Error(`Failed to step ${direction}: ${error}`);
    }
    const snapshot = this.#pausedAfter(generation) ?? (await waiting);
    return {
      status: 'paused',
      snapshot: this.#toPausedStateView(snapshot, false),
    };
  }

  async resume(): Promise<void> {
    this.#paused = undefined;
    const response = await this.#agent.invoke_resume({
      terminateOnResume: false,
    });
    const error = response.getError();
    if (error) {
      throw new Error(`Failed to resume: ${error}`);
    }
  }

  async evaluateOnCallFrame(
    options: EvaluateOnCallFrameOptions,
  ): Promise<EvaluationResultLike> {
    const paused = this.#assertPausedGeneration(
      options.callFrameId,
      'callFrameId',
      true,
    );
    const request: EvaluateOnCallFrameRequest = {
      callFrameId: options.callFrameId,
      expression: options.expression,
    };
    if (options.objectGroup !== undefined) {
      request.objectGroup = options.objectGroup;
    }
    if (options.returnByValue !== undefined) {
      request.returnByValue = options.returnByValue;
    }
    if (options.generatePreview !== undefined) {
      request.generatePreview = options.generatePreview;
    }
    if (options.throwOnSideEffect !== undefined) {
      request.throwOnSideEffect = options.throwOnSideEffect;
    }
    if (options.timeout !== undefined) {
      request.timeout = options.timeout;
    }
    if (options.scopeNumber !== undefined) {
      request.scopeNumber = options.scopeNumber;
    }
    const response = await this.#agent.invoke_evaluateOnCallFrame(request);
    if (!this.#paused || this.#paused.generation !== paused.generation) {
      throw new Error(
        `callFrameId ${options.callFrameId} is stale for generation ${paused.generation}; the pause generation changed.`,
      );
    }
    const error = response.getError();
    if (error) {
      throw new Error(`Failed to evaluate expression: ${error}`);
    }
    const result: EvaluationResultLike = {result: response.result};
    if (response.exceptionDetails !== undefined) {
      result.exceptionDetails = response.exceptionDetails;
    }
    return result;
  }

  async getObjectProperties(
    options: GetObjectPropertiesOptions,
  ): Promise<ObjectPropertiesView> {
    const paused = this.#assertPausedGeneration(
      options.objectId,
      'objectId',
      false,
    );
    const response = await this.#session.send('Runtime.getProperties', {
      objectId: options.objectId,
      ownProperties: options.ownProperties ?? true,
      generatePreview: options.generatePreview ?? false,
    });
    if (!this.#paused || this.#paused.generation !== paused.generation) {
      throw new Error(
        `objectId ${options.objectId} is stale for generation ${paused.generation}; the pause generation changed.`,
      );
    }
    const maxProperties = options.maxProperties ?? 100;
    const depth = options.depth ?? 1;
    if (!Number.isInteger(maxProperties) || maxProperties < 1) {
      throw new Error(
        `Invalid maxProperties=${maxProperties}; expected a positive integer.`,
      );
    }
    if (!Number.isInteger(depth) || depth < 0 || depth > 1) {
      throw new Error(
        `Invalid depth=${depth}; expected 0 or 1 for the bounded property view.`,
      );
    }
    const properties: ObjectPropertyView[] = [];
    for (const property of response.result.slice(0, maxProperties)) {
      const view: ObjectPropertyView = {name: property.name};
      if (property.value !== undefined) {
        view.value = property.value;
      }
      properties.push(view);
    }
    return {
      objectId: options.objectId,
      generation: paused.generation,
      properties,
      truncated: response.result.length > maxProperties,
      depth,
    };
  }

  getPausedState(options?: {includeScopes?: boolean}): PausedStateView {
    const paused = this.#paused;
    if (!paused) {
      return {
        generation: this.#generation,
        paused: false,
        hitBreakpoints: [],
        callFrames: [],
      };
    }
    return this.#toPausedStateView(paused, options?.includeScopes ?? false);
  }

  #assertPausedGeneration(
    id: string,
    kind: 'callFrameId' | 'objectId',
    isFrame: boolean,
  ): PausedSnapshot {
    const paused = this.#paused;
    if (!paused) {
      throw new Error(
        `${kind} ${id} is stale for generation ${this.#generation}; the page is not paused.`,
      );
    }
    const exists = isFrame
      ? paused.callFrames.some(frame => frame.callFrameId === id)
      : paused.callFrames.some(frame =>
          frame.scopeChain?.some(scope => scope.objectId === id),
        );
    if (!exists) {
      throw new Error(
        `${kind} ${id} is stale for generation ${this.#generation}; it does not belong to generation ${paused.generation}.`,
      );
    }
    return paused;
  }

  #toPausedStateView(
    paused: PausedSnapshot,
    includeScopes: boolean,
  ): PausedStateView {
    return {
      generation: paused.generation,
      paused: true,
      reason: paused.reason,
      hitBreakpoints: paused.hitBreakpoints,
      callFrames: includeScopes
        ? paused.callFrames
        : paused.callFrames.map(frame => ({
            callFrameId: frame.callFrameId,
            functionName: frame.functionName,
            url: frame.url,
            scriptId: frame.scriptId,
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber,
          })),
    };
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
    this.#disposeWaiterReason = '';
    this.#rejectWaiters('Debug Session was disposed.');
    this.disable();
    this.#disposed = true;
  }

  #settleWaiter(waiter: Waiter, snapshot: PausedSnapshot): void {
    clearTimeout(waiter.timeout);
    waiter.settled = true;
    waiter.resolve(snapshot);
    this.#waiters.delete(waiter);
  }

  #pausedAfter(generation: number): PausedSnapshot | undefined {
    const paused = this.#paused;
    if (paused && paused.generation > generation) {
      return paused;
    }
    return undefined;
  }

  #addWaiter(
    options: {timeout?: number} | undefined,
    afterGeneration: number | undefined,
  ): Promise<PausedSnapshot> {
    let timeout: number;
    try {
      timeout = validateTimeout(options?.timeout ?? DEFAULT_WAIT_TIMEOUT);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return new Promise<PausedSnapshot>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        settled: false,
        timeout: setTimeout(() => {
          if (waiter.settled) {
            return;
          }
          waiter.settled = true;
          this.#waiters.delete(waiter);
          reject(
            new Error(`Timed out waiting for a pause after ${timeout}ms.`),
          );
        }, timeout),
      };
      if (afterGeneration !== undefined) {
        waiter.afterGeneration = afterGeneration;
      }
      this.#waiters.add(waiter);
    });
  }

  #rejectWaiters(reason: string): void {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timeout);
      if (!waiter.settled) {
        waiter.settled = true;
        waiter.reject(new Error(reason));
      }
    }
    this.#waiters.clear();
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
