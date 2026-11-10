/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import type {
  BreakpointRecord,
  PausedStateView,
  EvaluationResultLike,
  ObjectPropertiesView,
  PauseResult,
  PendingPauseResult,
  PausedSnapshot,
} from '../../src/DebuggerController.js';
import type {
  ScriptListResult,
  ScriptSearchResult,
  ScriptSourceResult,
} from '../../src/ScriptManager.js';
import type {PageToolFactory} from '../../src/tools/ToolDefinition.js';
import * as debuggerTools from '../../src/tools/debugger.js';
import {createTools} from '../../src/tools/tools.js';
import {ToolCategory} from '../../src/tools/categories.js';
import type {DevTools} from '../../src/third_party/index.js';
import {zod} from '../../src/third_party/index.js';
import {createHandlerMocks, createMockParsedArguments} from '../mocks.js';

const TOOL_NAMES = [
  'debugger_set_breakpoint',
  'debugger_list_breakpoints',
  'debugger_remove_breakpoint',
  'debugger_pause',
  'debugger_resume',
  'debugger_step',
  'debugger_disable',
  'debugger_wait_for_paused',
  'debugger_get_paused_state',
  'debugger_evaluate',
  'debugger_get_object_properties',
  'list_scripts',
  'get_script_source',
  'search_in_scripts',
] as const;

const MUTATING_TOOL_NAMES = [
  'debugger_set_breakpoint',
  'debugger_remove_breakpoint',
  'debugger_pause',
  'debugger_resume',
  'debugger_step',
  'debugger_disable',
  'debugger_evaluate',
  'debugger_get_object_properties',
  'list_scripts',
  'get_script_source',
  'search_in_scripts',
  'debugger_list_breakpoints',
  'debugger_get_paused_state',
] as const;

const BREAKPOINT: BreakpointRecord = {
  breakpointId: 'bp-1',
  requested: {url: 'http://example.com/app.js', lineNumber: 7},
  resolved: [{scriptId: '1', lineNumber: 7, columnNumber: 3}],
  bound: true,
};

const PAUSED_SNAPSHOT: PausedSnapshot = {
  generation: 2,
  paused: true,
  reason: 'other',
  hitBreakpoints: ['bp-1'],
  callFrames: [
    {
      callFrameId: 'frame-1',
      functionName: 'run',
      url: 'http://example.com/app.js',
      scriptId: '1',
      lineNumber: 7,
      columnNumber: 3,
    },
  ],
};

const PAUSED_STATE: PausedStateView = {
  generation: 2,
  paused: true,
  reason: 'other',
  hitBreakpoints: ['bp-1'],
  callFrames: [
    {
      callFrameId: 'frame-1',
      functionName: 'run',
      url: 'http://example.com/app.js',
      scriptId: '1',
      lineNumber: 7,
      columnNumber: 3,
    },
  ],
};

const PAUSE_RESULT: PauseResult = {status: 'paused', snapshot: PAUSED_STATE};
const PENDING_PAUSE_RESULT: PendingPauseResult = {
  status: 'pending',
  generation: 2,
};

const EVALUATION_RESULT: EvaluationResultLike = {
  result: {type: 'number', value: 3},
};

const OBJECT_PROPERTIES: ObjectPropertiesView = {
  objectId: 'obj-1',
  generation: 2,
  properties: [{name: 'x', value: {type: 'number', value: 3}}],
  truncated: false,
  depth: 1,
};

const SCRIPT_LIST: ScriptListResult = {
  scripts: [
    {
      scriptId: '1',
      url: 'http://example.com/app.js',
      length: 100,
      isModule: false,
      startLine: 1,
      startColumn: 1,
      endLine: 10,
      endColumn: 1,
    },
  ],
  total: 1,
  truncated: false,
};

const SCRIPT_SOURCE: ScriptSourceResult = {
  scriptId: '1',
  url: 'http://example.com/app.js',
  startLine: 4,
  endLine: 5,
  totalLines: 10,
  byteLength: 20,
  lines: [
    {lineNumber: 4, text: 'const a = 1;'},
    {lineNumber: 5, text: 'const b = 2;'},
  ],
  previewTruncated: false,
};

const EXPORTED_SCRIPT_SOURCE: ScriptSourceResult = {
  ...SCRIPT_SOURCE,
  filePath: 'D:/tmp/app.js',
};

const SEARCH_RESULT: ScriptSearchResult = {
  query: 'needle',
  matchCount: 1,
  scannedScripts: 1,
  truncated: false,
  matches: [
    {
      scriptId: '1',
      url: 'http://example.com/app.js',
      lineNumber: 4,
      columnNumber: 7,
      matchText: 'needle',
      lineContent: 'const needle = 1;',
      contextLines: [],
    },
  ],
};

const EXPORTED_SEARCH_RESULT: ScriptSearchResult = {
  query: 'needle',
  matchCount: 1,
  scannedScripts: 1,
  truncated: false,
  filePath: 'D:/tmp/matches.json',
};

type ScriptId = DevTools.Protocol.Runtime.ScriptId;

function scriptId(value: string): ScriptId;
function scriptId(value: string): string {
  return value;
}

function tool(name: string): PageToolFactory {
  const factory = Object.values(debuggerTools).find(
    candidate => candidate(createMockParsedArguments()).name === name,
  );
  assert.ok(factory, `Missing debugger tool ${name}`);
  return factory;
}

function toolNames(): string[] {
  const args = createMockParsedArguments();
  return Object.values(debuggerTools).map(factory => factory(args).name);
}

describe('debugger tools', () => {
  it('defines all 14 tools with exact names and unique names', () => {
    assert.deepStrictEqual([...toolNames()].sort(), [...TOOL_NAMES].sort());
    const names = createTools(createMockParsedArguments()).map(t => t.name);
    assert.strictEqual(new Set(names).size, names.length);
  });

  it('registers every tool with the shared page-tool contract', () => {
    const args = createMockParsedArguments();
    for (const factory of Object.values(debuggerTools)) {
      const definition = factory(args);
      assert.strictEqual(definition.pageScoped, true);
      assert.strictEqual(definition.blockedByDialog, false);
      assert.strictEqual(
        definition.annotations.category,
        ToolCategory.DEBUGGING,
      );
      assert.strictEqual(
        definition.concurrency,
        definition.name === 'debugger_wait_for_paused' ? 'none' : 'page',
      );
    }
    assert.strictEqual(MUTATING_TOOL_NAMES.length, 13);
  });

  it('gates only JavaScript evaluation tools', () => {
    const args = createMockParsedArguments();
    const gated = Object.values(debuggerTools)
      .map(factory => factory(args))
      .filter(definition =>
        definition.annotations.conditions?.includes('javascriptEvaluation'),
      )
      .map(definition => definition.name)
      .sort();
    assert.deepStrictEqual(gated, [
      'debugger_evaluate',
      'debugger_set_breakpoint',
    ]);
  });

  it('verifies file paths only on script export tools', () => {
    const args = createMockParsedArguments();
    for (const factory of Object.values(debuggerTools)) {
      const definition = factory(args);
      const expected =
        definition.name === 'get_script_source' ||
        definition.name === 'search_in_scripts'
          ? {filePath: true}
          : {};
      assert.deepStrictEqual(definition.verifyFilesSchema, expected);
    }
  });

  describe('debugger_set_breakpoint', () => {
    it('passes 1-based url coordinates and condition to the page', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.setBreakpoint.resolves({...BREAKPOINT, condition: 'x > 1'});

      await tool('debugger_set_breakpoint')(args).handler(
        {
          params: {
            url: 'http://example.com/app.js',
            lineNumber: 7,
            columnNumber: 3,
            condition: 'x > 1',
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.setBreakpoint, {
        url: 'http://example.com/app.js',
        lineNumber: 7,
        columnNumber: 3,
        condition: 'x > 1',
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          '1 breakpoint(s):',
          '- bp-1 at http://example.com/app.js:7 [bound] condition: x > 1',
          '  resolved: script 1:7:3',
        ].join('\n'),
      );
    });

    it('rejects a request with both or neither location field', async () => {
      const {page, context, response, args} = createHandlerMocks();
      const definition = tool('debugger_set_breakpoint')(args);
      await assert.rejects(
        definition.handler({params: {lineNumber: 7}, page}, response, context),
        /exactly one of url or scriptId/,
      );
      await assert.rejects(
        definition.handler(
          {params: {url: 'u', scriptId: '1', lineNumber: 7}, page},
          response,
          context,
        ),
        /exactly one of url or scriptId/,
      );
      sinon.assert.notCalled(page.setBreakpoint);
    });

    it('passes scriptId without url', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.setBreakpoint.resolves(BREAKPOINT);

      await tool('debugger_set_breakpoint')(args).handler(
        {params: {scriptId: '1', lineNumber: 7}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.setBreakpoint, {
        scriptId: '1',
        lineNumber: 7,
      });
      sinon.assert.calledOnce(response.appendResponseLine);
    });

    it('accepts either a URL or a script ID with the line number', () => {
      const args = createMockParsedArguments({pageIdRouting: false});
      const schema = zod.object(tool('debugger_set_breakpoint')(args).schema);
      assert.strictEqual(
        schema.safeParse({url: 'u', lineNumber: 7}).success,
        true,
      );
      assert.strictEqual(
        schema.safeParse({scriptId: '1', lineNumber: 7}).success,
        true,
      );
      assert.strictEqual(schema.safeParse({url: 'u'}).success, false);
    });

    it('rejects 0-based or fractional coordinates in the schema', () => {
      const args = createMockParsedArguments({pageIdRouting: false});
      const schema = zod.object(tool('debugger_set_breakpoint')(args).schema);
      assert.strictEqual(
        schema.safeParse({url: 'u', lineNumber: 0}).success,
        false,
      );
      assert.strictEqual(
        schema.safeParse({url: 'u', lineNumber: 1.5}).success,
        false,
      );
      assert.strictEqual(
        schema.safeParse({url: 'u', lineNumber: 1, columnNumber: 0}).success,
        false,
      );
    });
  });

  describe('debugger_list_breakpoints', () => {
    it('formats the page breakpoint records', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.listBreakpoints.returns([BREAKPOINT]);

      await tool('debugger_list_breakpoints')(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.listBreakpoints);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          '1 breakpoint(s):',
          '- bp-1 at http://example.com/app.js:7 [bound]',
          '  resolved: script 1:7:3',
        ].join('\n'),
      );
    });
  });

  describe('debugger_remove_breakpoint', () => {
    it('passes the breakpoint id and reports the result', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.removeBreakpoint.resolves(true);

      await tool('debugger_remove_breakpoint')(args).handler(
        {params: {breakpointId: 'bp-1'}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.removeBreakpoint, 'bp-1');
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Removed breakpoint bp-1.',
      );
    });

    it('reports a missing breakpoint', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.removeBreakpoint.resolves(false);

      await tool('debugger_remove_breakpoint')(args).handler(
        {params: {breakpointId: 'bp-2'}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Breakpoint bp-2 was not found.',
      );
    });
  });

  describe('debugger_pause', () => {
    it('passes the timeout and formats the paused state', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pause.resolves(PAUSE_RESULT);

      await tool('debugger_pause')(args).handler(
        {params: {timeout: 5_000}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.pause, {timeout: 5_000});
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          'Paused: other',
          'hit breakpoints: bp-1',
          'call frames:',
          '  run at http://example.com/app.js:7:3',
        ].join('\n'),
      );
    });

    it('reports a pending pause', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pause.resolves(PENDING_PAUSE_RESULT);

      await tool('debugger_pause')(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.pause, {});
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Pause pending for generation 2; call debugger_wait_for_paused.',
      );
    });
  });

  describe('debugger_resume', () => {
    it('resumes the page', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.resume.resolves();

      await tool('debugger_resume')(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.resume);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Execution resumed.',
      );
    });
  });

  describe('debugger_step', () => {
    it('passes the direction and timeout', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.step.resolves(PAUSE_RESULT);

      await tool('debugger_step')(args).handler(
        {params: {direction: 'over', timeout: 5_000}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.step, 'over', {
        timeout: 5_000,
      });
      sinon.assert.calledOnce(response.appendResponseLine);
    });

    it('rejects an unknown direction in the schema', () => {
      const args = createMockParsedArguments({pageIdRouting: false});
      const schema = zod.object(tool('debugger_step')(args).schema);
      assert.strictEqual(schema.safeParse({direction: 'up'}).success, false);
      assert.strictEqual(schema.safeParse({direction: 'into'}).success, true);
    });
  });

  describe('debugger_disable', () => {
    it('disables the Debug Session', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.disable.resolves();

      await tool('debugger_disable')(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.disable);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Debug Session disabled.',
      );
    });
  });

  describe('debugger_wait_for_paused', () => {
    it('passes the timeout and formats the snapshot', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.waitForPaused.resolves(PAUSED_SNAPSHOT);

      await tool('debugger_wait_for_paused')(args).handler(
        {params: {timeout: 12_000}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.waitForPaused, {
        timeout: 12_000,
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          'Paused: other',
          'hit breakpoints: bp-1',
          'call frames:',
          '  run at http://example.com/app.js:7:3',
        ].join('\n'),
      );
    });

    it('caps the timeout at 30s and defaults to 10s in the schema', () => {
      const args = createMockParsedArguments({pageIdRouting: false});
      const definition = tool('debugger_wait_for_paused')(args);
      assert.strictEqual(definition.concurrency, 'none');
      const schema = zod.object(definition.schema);
      assert.strictEqual(schema.safeParse({timeout: 30_001}).success, false);
      assert.strictEqual(schema.safeParse({timeout: 30_000}).success, true);
      assert.strictEqual(schema.safeParse({timeout: 0}).success, false);
      assert.deepStrictEqual(schema.parse({}), {timeout: 10_000});
    });
  });

  describe('debugger_get_paused_state', () => {
    it('passes includeScopes and formats the state', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.getPausedState.returns(PAUSED_STATE);

      await tool('debugger_get_paused_state')(args).handler(
        {params: {includeScopes: true}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.getPausedState, {
        includeScopes: true,
      });
      sinon.assert.calledOnce(response.appendResponseLine);
    });

    it('reports a page that is not paused', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.getPausedState.returns({
        generation: 2,
        paused: false,
        hitBreakpoints: [],
        callFrames: [],
      });

      await tool('debugger_get_paused_state')(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.getPausedState, {});
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'The page is not paused.',
      );
    });
  });

  describe('debugger_evaluate', () => {
    it('maps options to evaluateOnCallFrame and formats the result', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.evaluateOnCallFrame.resolves(EVALUATION_RESULT);

      await tool('debugger_evaluate')(args).handler(
        {
          params: {
            callFrameId: 'frame-1',
            expression: '1 + 2',
            returnByValue: true,
            generatePreview: false,
            throwOnSideEffect: true,
            timeout: 1_000,
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.evaluateOnCallFrame, {
        callFrameId: 'frame-1',
        expression: '1 + 2',
        returnByValue: true,
        generatePreview: false,
        throwOnSideEffect: true,
        timeout: 1_000,
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Result: 3',
      );
    });

    it('is gated by javascriptEvaluation', () => {
      const args = createMockParsedArguments();
      assert.deepStrictEqual(
        tool('debugger_evaluate')(args).annotations.conditions,
        ['javascriptEvaluation'],
      );
    });
  });

  describe('debugger_get_object_properties', () => {
    it('maps options to getObjectProperties and formats the result', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.getObjectProperties.resolves(OBJECT_PROPERTIES);

      await tool('debugger_get_object_properties')(args).handler(
        {
          params: {objectId: 'obj-1', maxProperties: 5, depth: 0},
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.getObjectProperties, {
        objectId: 'obj-1',
        maxProperties: 5,
        depth: 0,
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        ['obj-1 (generation 2):', '  x = 3'].join('\n'),
      );
    });
  });

  describe('list_scripts', () => {
    it('passes the filter and bound to listScripts', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.listScripts.returns(SCRIPT_LIST);

      await tool('list_scripts')(args).handler(
        {params: {urlFilter: 'app.js', maxScripts: 10}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.listScripts, {
        urlFilter: 'app.js',
        maxScripts: 10,
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          '1 script(s) (total 1):',
          '- 1 http://example.com/app.js (100 bytes, lines 1-10)',
        ].join('\n'),
      );
    });
  });

  describe('get_script_source', () => {
    it('passes 1-based line range and filePath', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.getScriptSource.resolves(SCRIPT_SOURCE);

      await tool('get_script_source')(args).handler(
        {params: {scriptId: '1', startLine: 4, endLine: 5}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.getScriptSource, {
        scriptId: scriptId('1'),
        startLine: 4,
        endLine: 5,
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          'Script 1 http://example.com/app.js lines 4-5 of 10 (20 bytes):',
          '  4: const a = 1;',
          '  5: const b = 2;',
        ].join('\n'),
      );
    });

    it('reports the exported file path and preview truncation', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.getScriptSource.resolves(EXPORTED_SCRIPT_SOURCE);

      await tool('get_script_source')(args).handler(
        {params: {scriptId: '1', filePath: 'D:/tmp/app.js'}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.getScriptSource, {
        scriptId: scriptId('1'),
        filePath: 'D:/tmp/app.js',
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          'Script 1 http://example.com/app.js lines 4-5 of 10 (20 bytes):',
          '  4: const a = 1;',
          '  5: const b = 2;',
          'Exported to D:/tmp/app.js.',
        ].join('\n'),
      );
    });

    it('validates filePath and rejects 0-based lines in the schema', () => {
      const args = createMockParsedArguments();
      const definition = tool('get_script_source')(args);
      assert.deepStrictEqual(definition.verifyFilesSchema, {filePath: true});
      const schema = zod.object(definition.schema);
      assert.strictEqual(
        schema.safeParse({scriptId: '1', startLine: 0}).success,
        false,
      );
      assert.strictEqual(
        schema.safeParse({scriptId: '1', startLine: 1.5}).success,
        false,
      );
      assert.strictEqual(
        schema.safeParse({scriptId: '1', startLine: 9, endLine: 4}).success,
        false,
      );
    });
  });

  describe('search_in_scripts', () => {
    it('maps search options and formats matches', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.searchInScripts.resolves(SEARCH_RESULT);

      await tool('search_in_scripts')(args).handler(
        {
          params: {
            query: 'needle',
            caseSensitive: true,
            isRegex: false,
            urlFilter: 'app.js',
            contextLines: 2,
            maxMatches: 10,
            maxScripts: 5,
            excludeMinified: true,
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.searchInScripts, {
        query: 'needle',
        caseSensitive: true,
        isRegex: false,
        urlFilter: 'app.js',
        contextLines: 2,
        maxMatches: 10,
        maxScripts: 5,
        excludeMinified: true,
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          '1 of 1 match(es) for "needle":',
          'script 1 http://example.com/app.js:4:7',
          '  line: const needle = 1;',
        ].join('\n'),
      );
    });

    it('reports the exported match summary without matches', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.searchInScripts.resolves(EXPORTED_SEARCH_RESULT);

      await tool('search_in_scripts')(args).handler(
        {params: {query: 'needle', filePath: 'D:/tmp/matches.json'}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.searchInScripts, {
        query: 'needle',
        filePath: 'D:/tmp/matches.json',
      });
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        [
          '1 match(es) for "needle" in 1 script(s):',
          'Exported to D:/tmp/matches.json.',
        ].join('\n'),
      );
    });

    it('validates filePath and bounds in the schema', () => {
      const args = createMockParsedArguments();
      const definition = tool('search_in_scripts')(args);
      assert.deepStrictEqual(definition.verifyFilesSchema, {filePath: true});
      const schema = zod.object(definition.schema);
      assert.strictEqual(schema.safeParse({query: ''}).success, false);
      assert.strictEqual(
        schema.safeParse({query: 'x', contextLines: 21}).success,
        false,
      );
      assert.strictEqual(
        schema.safeParse({query: 'x', maxMatches: 0}).success,
        false,
      );
    });
  });

  it('propagates page errors without emitting a response line', async () => {
    const {page, context, response, args} = createHandlerMocks();
    page.listBreakpoints.throws(new Error('Debug Session unavailable.'));

    await assert.rejects(
      tool('debugger_list_breakpoints')(args).handler(
        {params: {}, page},
        response,
        context,
      ),
      /Debug Session unavailable\./,
    );
    sinon.assert.notCalled(response.appendResponseLine);
  });
});
