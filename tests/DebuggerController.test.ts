/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {DebuggerController} from '../src/DebuggerController.js';
import {DevTools} from '../src/third_party/index.js';
import {
  createMockCDPSession,
  createMockTargetUniverse,
  type MockCDPSession,
} from './mocks.js';

export interface SettingsLike {
  resolve(descriptor: typeof DevTools.skipAllPausesSettingDescriptor): {
    set(value: boolean): void;
  };
}

export interface UniverseLike {
  settings: SettingsLike;
}

export interface DebuggerAgentLike {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_setBreakpointByUrl: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_setBreakpoint: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_removeBreakpoint: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_pause: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_resume: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_stepInto: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_stepOver: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_stepOut: sinon.SinonStub;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  invoke_evaluateOnCallFrame: sinon.SinonStub;
}

export interface RuntimePropertyDescriptor {
  name: string;
  value?: {type: string; value?: number | string | boolean};
}

export interface RuntimeGetPropertiesResponse {
  result: RuntimePropertyDescriptor[];
  getError(): string | undefined;
}

export interface SessionLike {
  on(event: string, listener: (event: unknown) => void): SessionLike;
  off(event: string, listener: (event: unknown) => void): SessionLike;
  send(
    method: 'Runtime.getProperties',
    params: {
      objectId: string;
      ownProperties?: boolean;
      generatePreview?: boolean;
    },
  ): Promise<RuntimeGetPropertiesResponse>;
}

export interface ControllerFixture {
  controller: DebuggerController;
  session: sinon.SinonStubbedInstance<MockCDPSession>;
  send: sinon.SinonStub<
    Parameters<SessionLike['send']>,
    Promise<RuntimeGetPropertiesResponse>
  >;
  agent: DebuggerAgentLike;
  set: sinon.SinonStub;
}

function createFixture(): ControllerFixture {
  const session = createMockCDPSession();
  const send = sinon.stub<
    Parameters<SessionLike['send']>,
    Promise<RuntimeGetPropertiesResponse>
  >();
  send.resolves({result: [], getError: () => undefined});
  Object.defineProperty(session, 'send', {value: send});
  const set = sinon.stub();
  const settings: SettingsLike = {
    resolve: sinon.stub().returns({set}),
  };
  const agent: DebuggerAgentLike = {
    invoke_setBreakpointByUrl: sinon.stub(),
    invoke_setBreakpoint: sinon.stub(),
    invoke_removeBreakpoint: sinon.stub().resolves({getError: () => undefined}),
    invoke_pause: sinon.stub().resolves({getError: () => undefined}),
    invoke_resume: sinon.stub().resolves({getError: () => undefined}),
    invoke_stepInto: sinon.stub().resolves({getError: () => undefined}),
    invoke_stepOver: sinon.stub().resolves({getError: () => undefined}),
    invoke_stepOut: sinon.stub().resolves({getError: () => undefined}),
    invoke_evaluateOnCallFrame: sinon.stub(),
  };
  const model = sinon.createStubInstance(DevTools.DebuggerModel);
  Object.defineProperty(model, 'agent', {value: agent});
  const devtools = createMockTargetUniverse(model);
  devtools.session = session;
  Object.defineProperty(devtools.universe, 'settings', {
    value: settings,
  });
  return {
    controller: new DebuggerController(devtools),
    session,
    send,
    agent,
    set,
  };
}

function breakpointResponse(
  breakpointId: string,
  locations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
  }> = [],
): {
  breakpointId: string;
  locations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
  }>;
  getError(): string | undefined;
} {
  return {
    breakpointId,
    locations,
    getError: () => undefined,
  };
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function pausedEvent(generation: number) {
  return {
    reason: 'breakpoint',
    hitBreakpoints: [`bp-${generation}`],
    callFrames: [
      {
        callFrameId: `frame-${generation}`,
        functionName: `run${generation}`,
        url: 'https://example.com/app.js',
        location: {scriptId: 'script-1', lineNumber: 9, columnNumber: 4},
        scopeChain: [
          {
            type: 'local',
            object: {type: 'object', objectId: `scope-${generation}`},
          },
        ],
      },
    ],
  };
}

function emitSessionEvent(
  session: ControllerFixture['session'],
  event: 'Debugger.paused' | 'Debugger.resumed',
  data?: unknown,
): void {
  const call =
    event === 'Debugger.paused' ? session.on.firstCall : session.on.secondCall;
  const handler = call.args[1];
  handler(data);
}

describe('DebuggerController', () => {
  it('stores a bounded 1-based Paused Snapshot for each generation', () => {
    const {controller, session} = createFixture();
    controller.enable();

    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));
    const first = controller.getPausedState({includeScopes: true});
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(2));
    const second = controller.getPausedState({includeScopes: false});

    assert.deepStrictEqual(first, {
      generation: 1,
      paused: true,
      reason: 'breakpoint',
      hitBreakpoints: ['bp-1'],
      callFrames: [
        {
          callFrameId: 'frame-1',
          functionName: 'run1',
          url: 'https://example.com/app.js',
          scriptId: 'script-1',
          lineNumber: 10,
          columnNumber: 5,
          scopeChain: [{type: 'local', objectId: 'scope-1'}],
        },
      ],
    });
    assert.deepStrictEqual(second, {
      generation: 2,
      paused: true,
      reason: 'breakpoint',
      hitBreakpoints: ['bp-2'],
      callFrames: [
        {
          callFrameId: 'frame-2',
          functionName: 'run2',
          url: 'https://example.com/app.js',
          scriptId: 'script-1',
          lineNumber: 10,
          columnNumber: 5,
        },
      ],
    });
  });

  it('resumed and navigation invalidate snapshots while generation remains', () => {
    const {controller, session} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    emitSessionEvent(session, 'Debugger.resumed');
    assert.deepStrictEqual(controller.getPausedState(), {
      generation: 1,
      paused: false,
      hitBreakpoints: [],
      callFrames: [],
    });

    emitSessionEvent(session, 'Debugger.paused', pausedEvent(2));
    assert.strictEqual(controller.getPausedState().generation, 2);
    controller.invalidatePausedState();

    assert.deepStrictEqual(controller.getPausedState(), {
      generation: 2,
      paused: false,
      hitBreakpoints: [],
      callFrames: [],
    });
  });

  it('waitForPaused() resolves on the next event and bounds invalid timeouts', async () => {
    const {controller, session} = createFixture();
    controller.enable();

    const waiting = controller.waitForPaused({timeout: 1});
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    assert.strictEqual((await waiting).generation, 1);
    await assert.rejects(
      controller.waitForPaused({timeout: 31_001}),
      /timeout=31001; exceeds maximum 30000ms/,
    );
  });

  it('waitForPaused() returns the current pause instead of timing out', async () => {
    const {controller, session} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    const snapshot = await controller.waitForPaused({timeout: 1});

    assert.strictEqual(snapshot.generation, 1);
  });

  it('waitForPaused() still bounds the timeout when the page is not paused', async () => {
    const {controller} = createFixture();
    controller.enable();

    await assert.rejects(
      controller.waitForPaused({timeout: 31_001}),
      /timeout=31001; exceeds maximum 30000ms/,
    );
    await assert.rejects(
      controller.waitForPaused({timeout: 1}),
      /Timed out waiting for a pause after 1ms/,
    );
  });

  it('disable() and dispose() reject pending waiters and invalidate snapshots', async () => {
    const disabled = createFixture();
    disabled.controller.enable();
    const waitingOnDisable = disabled.controller.waitForPaused();
    disabled.controller.disable();

    await assert.rejects(waitingOnDisable, /Debug Session was disabled/);
    assert.strictEqual(disabled.controller.getPausedState().paused, false);

    const disposed = createFixture();
    disposed.controller.enable();
    const waitingOnDispose = disposed.controller.waitForPaused();
    disposed.controller.dispose();

    await assert.rejects(waitingOnDispose, /Debug Session was disposed/);
    assert.strictEqual(disposed.controller.getPausedState().paused, false);
  });

  it('pause() waits for the next pause and reports pending on timeout', async () => {
    const {controller, session, agent} = createFixture();
    controller.enable();

    const pausing = controller.pause({timeout: 100});
    await flush();
    sinon.assert.calledOnceWithExactly(agent.invoke_pause);
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    assert.deepStrictEqual(await pausing, {
      status: 'paused',
      snapshot: {
        generation: 1,
        paused: true,
        reason: 'breakpoint',
        hitBreakpoints: ['bp-1'],
        callFrames: [
          {
            callFrameId: 'frame-1',
            functionName: 'run1',
            url: 'https://example.com/app.js',
            scriptId: 'script-1',
            lineNumber: 10,
            columnNumber: 5,
          },
        ],
      },
    });
    agent.invoke_pause.resetHistory();

    assert.deepStrictEqual(await controller.pause({timeout: 1}), {
      status: 'pending',
      generation: 1,
    });
    sinon.assert.calledOnceWithExactly(agent.invoke_pause);
  });

  it('resume() invalidates the snapshot and sends Debugger.resume', async () => {
    const {controller, session, agent} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    await controller.resume();

    sinon.assert.calledOnceWithExactly(agent.invoke_resume, {
      terminateOnResume: false,
    });
    assert.strictEqual(controller.getPausedState().paused, false);
    sinon.assert.notCalled(session.send);
  });

  it('step() invalidates the old generation and waits for the next pause', async () => {
    const {controller, session, agent} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    const stepping = controller.step('into', {timeout: 100});
    await flush();
    sinon.assert.calledOnceWithExactly(agent.invoke_stepInto, {
      breakOnAsyncCall: false,
    });
    assert.strictEqual(controller.getPausedState().paused, false);
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(2));

    assert.deepStrictEqual(await stepping, {
      status: 'paused',
      snapshot: {
        generation: 2,
        paused: true,
        reason: 'breakpoint',
        hitBreakpoints: ['bp-2'],
        callFrames: [
          {
            callFrameId: 'frame-2',
            functionName: 'run2',
            url: 'https://example.com/app.js',
            scriptId: 'script-1',
            lineNumber: 10,
            columnNumber: 5,
          },
        ],
      },
    });
  });

  it('step() maps over and out to their CDP commands', async () => {
    const {controller, session, agent} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    const over = controller.step('over', {timeout: 100});
    await flush();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(2));
    await over;
    sinon.assert.calledOnceWithExactly(agent.invoke_stepOver, {});
    sinon.assert.notCalled(agent.invoke_stepOut);

    const out = controller.step('out', {timeout: 100});
    await flush();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(3));
    await out;
    sinon.assert.calledOnceWithExactly(agent.invoke_stepOut);
  });

  it('step() rejects stale snapshots on timeout', async () => {
    const {controller, session} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    await assert.rejects(
      controller.step('over', {timeout: 1}),
      /Timed out waiting for a pause after 1ms/,
    );
  });

  it('evaluateOnCallFrame() passes options and rejects stale frame IDs', async () => {
    const {controller, session, agent} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));
    agent.invoke_evaluateOnCallFrame.resolves({
      result: {type: 'number', value: 7},
      getError: () => undefined,
    });

    assert.deepStrictEqual(
      await controller.evaluateOnCallFrame({
        callFrameId: 'frame-1',
        expression: 'answer',
        returnByValue: true,
        generatePreview: true,
        throwOnSideEffect: true,
        timeout: 500,
        scopeNumber: 1,
      }),
      {result: {type: 'number', value: 7}},
    );
    sinon.assert.calledOnceWithExactly(agent.invoke_evaluateOnCallFrame, {
      callFrameId: 'frame-1',
      expression: 'answer',
      returnByValue: true,
      generatePreview: true,
      throwOnSideEffect: true,
      timeout: 500,
      scopeNumber: 1,
    });

    controller.invalidatePausedState();
    await assert.rejects(
      controller.evaluateOnCallFrame({
        callFrameId: 'frame-1',
        expression: 'answer',
      }),
      /callFrameId frame-1 is stale for generation 1/,
    );
  });

  it('getObjectProperties() bounds results and rejects stale object IDs', async () => {
    const {controller, session, send} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));
    send.resolves({
      result: [
        {name: 'one', value: {type: 'number', value: 1}},
        {name: 'two', value: {type: 'number', value: 2}},
        {name: 'three', value: {type: 'number', value: 3}},
      ],
      getError: () => undefined,
    });

    assert.deepStrictEqual(
      await controller.getObjectProperties({
        objectId: 'scope-1',
        maxProperties: 2,
      }),
      {
        objectId: 'scope-1',
        generation: 1,
        properties: [
          {name: 'one', value: {type: 'number', value: 1}},
          {name: 'two', value: {type: 'number', value: 2}},
        ],
        truncated: true,
        depth: 1,
      },
    );
    sinon.assert.calledOnceWithExactly(send, 'Runtime.getProperties', {
      objectId: 'scope-1',
      ownProperties: true,
      generatePreview: false,
    });

    controller.invalidatePausedState();
    await assert.rejects(
      controller.getObjectProperties({objectId: 'scope-1'}),
      /objectId scope-1 is stale for generation 1/,
    );
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));
    await assert.rejects(
      controller.getObjectProperties({
        objectId: 'scope-1',
        depth: 2,
      }),
      /Invalid depth=2/,
    );
  });

  it('enable() sets skipAllPauses to false once', () => {
    const {controller, set} = createFixture();

    controller.enable();
    controller.enable();

    sinon.assert.calledOnceWithExactly(set, false);
  });

  it('enable() registers paused and resumed listeners on the session', () => {
    const {controller, session} = createFixture();

    controller.enable();

    sinon.assert.calledTwice(session.on);
    sinon.assert.calledWithExactly(
      session.on.firstCall,
      'Debugger.paused',
      sinon.match.func,
    );
    sinon.assert.calledWithExactly(
      session.on.secondCall,
      'Debugger.resumed',
      sinon.match.func,
    );
  });

  it('disable() restores skipAllPauses and removes both listeners', () => {
    const {controller, session, set} = createFixture();
    controller.enable();

    controller.disable();

    sinon.assert.calledTwice(set);
    sinon.assert.calledWithExactly(set.firstCall, false);
    sinon.assert.calledWithExactly(set.secondCall, true);
    sinon.assert.calledTwice(session.off);
  });

  it('disable() resumes a paused page before clearing the snapshot', () => {
    const {controller, session, agent} = createFixture();
    controller.enable();
    emitSessionEvent(session, 'Debugger.paused', pausedEvent(1));

    controller.disable();

    sinon.assert.calledOnceWithExactly(agent.invoke_resume, {
      terminateOnResume: false,
    });
    assert.strictEqual(controller.getPausedState().paused, false);
  });

  it('disable() does not resume a page that is not paused', () => {
    const {controller, agent} = createFixture();
    controller.enable();

    controller.disable();

    sinon.assert.notCalled(agent.invoke_resume);
  });

  it('setBreakpoint() converts 1-based URL coordinates to 0-based', async () => {
    const {controller, agent} = createFixture();
    agent.invoke_setBreakpointByUrl.resolves(
      breakpointResponse('bp-1', [
        {scriptId: '1', lineNumber: 9, columnNumber: 4},
      ]),
    );

    const record = await controller.setBreakpoint({
      url: 'https://example.com/app.js',
      lineNumber: 10,
      columnNumber: 5,
      condition: 'x > 1',
    });

    sinon.assert.calledOnceWithExactly(agent.invoke_setBreakpointByUrl, {
      lineNumber: 9,
      url: 'https://example.com/app.js',
      columnNumber: 4,
      condition: 'x > 1',
    });
    assert.deepStrictEqual(record.requested, {
      lineNumber: 10,
      url: 'https://example.com/app.js',
      columnNumber: 5,
    });
    assert.deepStrictEqual(record.resolved, [
      {scriptId: '1', lineNumber: 10, columnNumber: 5},
    ]);
    assert.strictEqual(record.bound, true);
  });

  it('setBreakpoint() uses setBreakpoint for scriptId locations', async () => {
    const {controller, agent} = createFixture();
    agent.invoke_setBreakpoint.resolves({
      breakpointId: 'bp-2',
      actualLocation: {scriptId: '2', lineNumber: 2},
      getError: () => undefined,
    });

    const record = await controller.setBreakpoint({
      scriptId: '2',
      lineNumber: 3,
    });

    sinon.assert.calledOnceWithExactly(agent.invoke_setBreakpoint, {
      location: {scriptId: '2', lineNumber: 2},
    });
    assert.deepStrictEqual(record.resolved, [{scriptId: '2', lineNumber: 3}]);
  });

  it('setBreakpoint() rejects omission and 0-based coordinates', async () => {
    const {controller, agent} = createFixture();

    await assert.rejects(
      controller.setBreakpoint({url: 'app.js', lineNumber: 0}),
      /lineNumber=0/,
    );
    await assert.rejects(
      controller.setBreakpoint({
        url: 'app.js',
        scriptId: '1',
        lineNumber: 1,
      }),
      /exactly one of url or scriptId/,
    );
    sinon.assert.notCalled(agent.invoke_setBreakpointByUrl);
    sinon.assert.notCalled(agent.invoke_setBreakpoint);
  });

  it('listBreakpoints() reports only breakpoints owned by the controller', async () => {
    const {controller, agent} = createFixture();
    agent.invoke_setBreakpointByUrl.resolves(breakpointResponse('bp-1'));

    await controller.setBreakpoint({url: 'app.js', lineNumber: 1});
    const records = controller.listBreakpoints();

    assert.deepStrictEqual(
      records.map(record => record.breakpointId),
      ['bp-1'],
    );
  });

  it('removeBreakpoint() removes only its own breakpoint', async () => {
    const {controller, agent} = createFixture();
    agent.invoke_setBreakpointByUrl.resolves(breakpointResponse('bp-1'));
    await controller.setBreakpoint({url: 'app.js', lineNumber: 1});

    const removed = await controller.removeBreakpoint('bp-1');
    const foreignRemoved = await controller.removeBreakpoint('logpoint-1');

    assert.strictEqual(removed, true);
    assert.strictEqual(foreignRemoved, false);
    sinon.assert.calledOnceWithExactly(agent.invoke_removeBreakpoint, {
      breakpointId: 'bp-1',
    });
    assert.deepStrictEqual(controller.listBreakpoints(), []);
  });

  it('disable() removes only controller-owned breakpoints', async () => {
    const {controller, agent} = createFixture();
    agent.invoke_setBreakpointByUrl.resolves(breakpointResponse('bp-1'));
    await controller.setBreakpoint({url: 'app.js', lineNumber: 1});

    controller.disable();
    await flush();

    sinon.assert.calledOnceWithExactly(agent.invoke_removeBreakpoint, {
      breakpointId: 'bp-1',
    });
    assert.deepStrictEqual(controller.listBreakpoints(), []);
  });

  it('dispose() is idempotent and restores skipAllPauses once', async () => {
    const {controller, session, set} = createFixture();
    controller.enable();

    controller.dispose();
    controller.dispose();
    await flush();

    sinon.assert.calledTwice(set);
    sinon.assert.calledWithExactly(set.firstCall, false);
    sinon.assert.calledWithExactly(set.secondCall, true);
    sinon.assert.calledTwice(session.off);
  });
});
