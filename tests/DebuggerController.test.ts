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
}

export interface ControllerFixture {
  controller: DebuggerController;
  session: sinon.SinonStubbedInstance<MockCDPSession>;
  agent: DebuggerAgentLike;
  set: sinon.SinonStub;
}

function createFixture(): ControllerFixture {
  const session = createMockCDPSession();
  const set = sinon.stub();
  const settings: SettingsLike = {
    resolve: sinon.stub().returns({set}),
  };
  const agent: DebuggerAgentLike = {
    invoke_setBreakpointByUrl: sinon.stub(),
    invoke_setBreakpoint: sinon.stub(),
    invoke_removeBreakpoint: sinon.stub().resolves({getError: () => undefined}),
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

describe('DebuggerController', () => {
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
