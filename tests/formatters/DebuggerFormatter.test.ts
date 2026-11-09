/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  BreakpointFormatter,
  type BreakpointRecord,
  PausedStateFormatter,
  type PausedState,
  ScopeSummaryFormatter,
  type ScopeSummary,
  EvaluationResultFormatter,
  type EvaluationResult,
  SearchMatchFormatter,
  type SearchMatches,
} from '../../src/formatters/DebuggerFormatter.js';
import type {Protocol} from '../../src/third_party/index.js';
import {truncateText} from '../../src/utils/text.js';

describe('BreakpointFormatter', () => {
  const record: BreakpointRecord = {
    breakpointId: 'bp-1',
    requested: {
      url: 'http://example.com/app.js',
      lineNumber: 12,
      columnNumber: 3,
    },
    resolved: [
      {
        scriptId: '7',
        lineNumber: 12,
        columnNumber: 7,
      },
      {
        url: 'http://example.com/app.js',
        lineNumber: 13,
        columnNumber: 1,
      },
    ],
    condition: 'value > 10',
    bound: true,
  };

  it('reports 1-based locations, condition and bound state', () => {
    const formatter = new BreakpointFormatter([record]);
    const json = formatter.toJSON();

    assert.strictEqual(json.breakpoints.length, 1);
    assert.deepStrictEqual(json, {
      total: 1,
      shown: 1,
      omitted: 0,
      breakpoints: [
        {
          breakpointId: 'bp-1',
          requested: 'http://example.com/app.js:12:3',
          resolved: ['script 7:12:7', 'http://example.com/app.js:13:1'],
          condition: 'value > 10',
          bound: true,
        },
      ],
    });
    assert.strictEqual(
      formatter.toString(),
      '1 breakpoint(s):\n' +
        '- bp-1 at http://example.com/app.js:12:3 [bound] ' +
        'condition: value > 10\n' +
        '  resolved: script 7:12:7, http://example.com/app.js:13:1',
    );
  });

  it('reports unbound breakpoints without resolved locations', () => {
    const formatter = new BreakpointFormatter([
      {
        breakpointId: 'bp-2',
        requested: {
          scriptId: '9',
          lineNumber: 1,
        },
        resolved: [],
        bound: false,
      },
    ]);

    assert.deepStrictEqual(formatter.toJSON(), {
      total: 1,
      shown: 1,
      omitted: 0,
      breakpoints: [
        {
          breakpointId: 'bp-2',
          requested: 'script 9:1',
          resolved: [],
          condition: undefined,
          bound: false,
        },
      ],
    });
    assert.strictEqual(
      formatter.toString(),
      '1 breakpoint(s):\n- bp-2 at script 9:1 [not bound]',
    );
  });

  it('bounds the number of formatted breakpoints', () => {
    const records: BreakpointRecord[] = [];
    for (let i = 1; i <= 5; i++) {
      records.push({
        breakpointId: `bp-${i}`,
        requested: {url: 'app.js', lineNumber: i},
        resolved: [],
        bound: false,
      });
    }
    const formatter = new BreakpointFormatter(records, {maxBreakpoints: 2});
    const json = formatter.toJSON();

    assert.deepStrictEqual(json, {
      total: 5,
      shown: 2,
      omitted: 3,
      breakpoints: [
        {
          breakpointId: 'bp-1',
          requested: 'app.js:1',
          resolved: [],
          condition: undefined,
          bound: false,
        },
        {
          breakpointId: 'bp-2',
          requested: 'app.js:2',
          resolved: [],
          condition: undefined,
          bound: false,
        },
      ],
    });
    assert.strictEqual(
      formatter.toString(),
      '2 of 5 breakpoint(s):\n' +
        '- bp-1 at app.js:1 [not bound]\n' +
        '- bp-2 at app.js:2 [not bound]\n' +
        '3 more breakpoint(s) omitted',
    );
  });

  it('formats an empty breakpoint list', () => {
    const formatter = new BreakpointFormatter([]);

    assert.deepStrictEqual(formatter.toJSON(), {
      total: 0,
      shown: 0,
      omitted: 0,
      breakpoints: [],
    });
    assert.strictEqual(formatter.toString(), 'No breakpoints are set.');
  });
});

describe('PausedStateFormatter', () => {
  const state: PausedState = {
    reason: 'breakpoint',
    hitBreakpoints: ['bp-1', 'bp-2'],
    callFrames: [
      {
        functionName: 'checkout',
        url: 'http://example.com/app.js',
        lineNumber: 12,
        columnNumber: 3,
      },
      {
        functionName: 'main',
        scriptId: '7',
        lineNumber: 1,
        columnNumber: 1,
      },
    ],
  };

  it('reports reason, hit breakpoints and 1-based call frames', () => {
    const formatter = new PausedStateFormatter(state);

    assert.deepStrictEqual(formatter.toJSON(), {
      reason: 'breakpoint',
      hitBreakpoints: ['bp-1', 'bp-2'],
      callFrameTotal: 2,
      callFrameOmitted: 0,
      callFrames: [
        {
          functionName: 'checkout',
          location: 'http://example.com/app.js:12:3',
        },
        {
          functionName: 'main',
          location: 'script 7:1:1',
        },
      ],
    });
    assert.strictEqual(
      formatter.toString(),
      'Paused: breakpoint\n' +
        'hit breakpoints: bp-1, bp-2\n' +
        'call frames:\n' +
        '  checkout at http://example.com/app.js:12:3\n' +
        '  main at script 7:1:1',
    );
  });

  it('bounds hit breakpoints and call frames and prints an empty state', () => {
    const formatter = new PausedStateFormatter(
      {...state, hitBreakpoints: []},
      {maxCallFrames: 1, maxHitBreakpoints: 1},
    );
    const empty = new PausedStateFormatter({
      reason: 'other',
      hitBreakpoints: [],
      callFrames: [],
    });

    assert.deepStrictEqual(formatter.toJSON(), {
      reason: 'breakpoint',
      hitBreakpoints: [],
      callFrameTotal: 2,
      callFrameOmitted: 1,
      callFrames: [
        {
          functionName: 'checkout',
          location: 'http://example.com/app.js:12:3',
        },
      ],
    });
    assert.strictEqual(
      formatter.toString(),
      'Paused: breakpoint\n' +
        'call frames:\n' +
        '  checkout at http://example.com/app.js:12:3\n' +
        '1 more call frame(s) omitted',
    );
    assert.strictEqual(empty.toString(), 'Paused: other');
    assert.deepStrictEqual(empty.toJSON(), {
      reason: 'other',
      hitBreakpoints: [],
      callFrameTotal: 0,
      callFrameOmitted: 0,
      callFrames: [],
    });
  });
});

function remoteObject(
  type: Protocol.Runtime.RemoteObject['type'],
  value: string,
): Protocol.Runtime.RemoteObject {
  return {type, value, description: value};
}

describe('ScopeSummaryFormatter', () => {
  const summary: ScopeSummary = {
    scopes: [
      {
        type: 'local',
        name: 'checkout',
        properties: [
          {name: 'total', value: remoteObject('number', '42')},
          {name: 'items', value: remoteObject('object', 'Array(2)')},
        ],
      },
      {
        type: 'global',
        object: remoteObject('object', 'Window'),
        properties: [
          {name: 'location', value: remoteObject('object', 'Location')},
        ],
      },
    ],
    properties: [
      {name: 'cart', value: remoteObject('object', 'Cart')},
      {name: 'missing'},
    ],
  };

  it('formats scope and property values with formatRemoteObject', () => {
    const formatter = new ScopeSummaryFormatter(summary);

    assert.deepStrictEqual(formatter.toJSON(), {
      scopes: [
        {
          type: 'local',
          name: 'checkout',
          object: undefined,
          properties: [
            {name: 'total', value: '42'},
            {name: 'items', value: 'Array(2)'},
          ],
          omittedProperties: 0,
        },
        {
          type: 'global',
          name: undefined,
          object: 'Window',
          properties: [{name: 'location', value: 'Location'}],
          omittedProperties: 0,
        },
      ],
      properties: [
        {name: 'cart', value: 'Cart'},
        {name: 'missing', value: undefined},
      ],
      scopeTotal: 2,
      scopeOmitted: 0,
      propertyOmitted: 0,
    });
    assert.strictEqual(
      formatter.toString(),
      'scopes:\n' +
        '  local "checkout": total = 42, items = Array(2)\n' +
        '  global (Window): location = Location\n' +
        'properties:\n' +
        '  cart = Cart\n' +
        '  missing = (unavailable)',
    );
  });

  it('bounds scopes, nested properties and top-level properties', () => {
    const formatter = new ScopeSummaryFormatter(summary, {
      maxDepth: 1,
      maxScopes: 1,
      maxPropertiesPerScope: 1,
      maxProperties: 1,
    });
    const json = formatter.toJSON();

    assert.deepStrictEqual(json.scopes, [
      {
        type: 'local',
        name: 'checkout',
        object: undefined,
        properties: [{name: 'total', value: '42'}],
        omittedProperties: 1,
      },
    ]);
    assert.strictEqual(json.scopeOmitted, 1);
    assert.strictEqual(json.propertyOmitted, 1);
    assert.deepStrictEqual(json.properties, [{name: 'cart', value: 'Cart'}]);
    assert.strictEqual(
      formatter.toString(),
      'scopes:\n' +
        '  local "checkout": total = 42 (1 more)\n' +
        '1 more scope(s) omitted\n' +
        'properties:\n' +
        '  cart = Cart\n' +
        '1 more property omitted',
    );
  });

  it('bounds nested property depth and count', () => {
    const nested: ScopeSummary = {
      scopes: [],
      properties: [
        {
          name: 'cart',
          value: remoteObject('object', 'Cart'),
          children: [
            {
              name: 'items',
              value: remoteObject('object', 'Array(2)'),
              children: [{name: '0', value: remoteObject('number', '7')}],
            },
            {name: 'owner', value: remoteObject('object', 'User')},
          ],
        },
      ],
    };

    const shallow = new ScopeSummaryFormatter(nested, {
      maxDepth: 1,
      maxPropertiesPerScope: 1,
    });
    const deep = new ScopeSummaryFormatter(nested, {
      maxDepth: 2,
      maxPropertiesPerScope: 1,
    });

    assert.deepStrictEqual(shallow.toJSON().properties, [
      {
        name: 'cart',
        value: 'Cart',
        omittedChildren: 2,
      },
    ]);
    assert.deepStrictEqual(deep.toJSON().properties, [
      {
        name: 'cart',
        value: 'Cart',
        omittedChildren: 1,
        children: [
          {
            name: 'items',
            value: 'Array(2)',
            omittedChildren: 1,
          },
        ],
      },
    ]);
    assert.strictEqual(
      deep.toString(),
      'properties:\n' +
        '  cart = Cart (1 nested omitted)\n' +
        '    items = Array(2) (1 nested omitted)',
    );
  });

  it('omits scope/property sections when there is nothing to report', () => {
    const formatter = new ScopeSummaryFormatter({
      scopes: [],
      properties: [],
    });

    assert.deepStrictEqual(formatter.toJSON(), {
      scopes: [],
      properties: [],
      scopeTotal: 0,
      scopeOmitted: 0,
      propertyOmitted: 0,
    });
    assert.strictEqual(formatter.toString(), 'No scopes or properties.');
  });
});

describe('EvaluationResultFormatter', () => {
  it('formats a RemoteObject result with formatRemoteObject', () => {
    const result: EvaluationResult = {
      result: remoteObject('number', '42'),
    };
    const formatter = new EvaluationResultFormatter(result);

    assert.deepStrictEqual(formatter.toJSON(), {
      result: '42',
      exception: undefined,
    });
    assert.strictEqual(formatter.toString(), 'Result: 42');
  });

  it('formats exceptionDetails as text without a RemoteObject result', () => {
    const result: EvaluationResult = {
      exceptionDetails: {
        exceptionId: 1,
        text: 'Uncaught TypeError: bad value',
        lineNumber: 0,
        columnNumber: 0,
        exception: remoteObject('object', 'TypeError: bad value'),
      },
    };
    const formatter = new EvaluationResultFormatter(result);

    assert.deepStrictEqual(formatter.toJSON(), {
      result: undefined,
      exception: 'Uncaught TypeError: bad value: TypeError: bad value',
    });
    assert.strictEqual(
      formatter.toString(),
      'Exception: Uncaught TypeError: bad value: TypeError: bad value',
    );
  });

  it('reports a missing result', () => {
    const formatter = new EvaluationResultFormatter({});

    assert.deepStrictEqual(formatter.toJSON(), {
      result: undefined,
      exception: undefined,
    });
    assert.strictEqual(formatter.toString(), 'No evaluation result.');
  });
});

describe('SearchMatchFormatter', () => {
  const matches: SearchMatches = {
    query: 'cart',
    matches: [
      {
        scriptId: '7',
        url: 'http://example.com/app.js',
        lineNumber: 12,
        lineContent: 'const cart = new Cart();',
        sourceLines: [
          'function checkout() {',
          'const cart = new Cart();',
          'return cart;',
        ],
      },
    ],
  };

  it('reports script, line, derived column and bounded context', () => {
    const formatter = new SearchMatchFormatter(matches, {
      contextLines: 1,
      maxLineLength: 80,
    });
    const json = formatter.toJSON();

    assert.deepStrictEqual(json, {
      query: 'cart',
      total: 1,
      shown: 1,
      omitted: 0,
      matches: [
        {
          scriptId: '7',
          url: 'http://example.com/app.js',
          lineNumber: 12,
          columnNumber: 7,
          lineContent: 'const cart = new Cart();',
          contextBefore: ['function checkout() {'],
          contextAfter: ['return cart;'],
        },
      ],
    });
    assert.strictEqual(
      formatter.toString(),
      '1 of 1 match(es) for "cart":\n' +
        'script 7 http://example.com/app.js:12:7\n' +
        '  context: function checkout() {\n' +
        '  line: const cart = new Cart();\n' +
        '  context: return cart;',
    );
  });

  it('derives columns for case-sensitive regex and literal queries', () => {
    const regex = new SearchMatchFormatter({
      query: 'C.rt',
      isRegex: true,
      caseSensitive: true,
      matches: [
        {
          scriptId: '7',
          lineNumber: 1,
          lineContent: 'new cart(); new Cart();',
        },
      ],
    });
    const insensitive = new SearchMatchFormatter({
      query: 'CART',
      matches: [
        {
          scriptId: '7',
          lineNumber: 1,
          lineContent: 'new Cart();',
        },
      ],
    });

    assert.strictEqual(regex.toJSON().matches[0].columnNumber, 17);
    assert.strictEqual(insensitive.toJSON().matches[0].columnNumber, 5);
  });

  it('leaves the column undefined for invalid regexes or no match', () => {
    const invalid = new SearchMatchFormatter({
      query: '(',
      isRegex: true,
      matches: [{scriptId: '7', lineNumber: 1, lineContent: 'const cart = 1;'}],
    });
    const absent = new SearchMatchFormatter({
      query: 'missing',
      matches: [{scriptId: '7', lineNumber: 1, lineContent: 'const cart = 1;'}],
    });

    assert.strictEqual(invalid.toJSON().matches[0].columnNumber, undefined);
    assert.strictEqual(absent.toJSON().matches[0].columnNumber, undefined);
  });

  it('bounds matches and grapheme-safe truncates long lines', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const longLine = `${'a'.repeat(20)}cart${family.repeat(20)}`;
    const formatter = new SearchMatchFormatter(
      {
        query: 'cart',
        matches: [
          {scriptId: '7', lineNumber: 1, lineContent: longLine},
          {scriptId: '7', lineNumber: 2, lineContent: 'cart'},
          {scriptId: '7', lineNumber: 3, lineContent: 'cart'},
        ],
      },
      {
        maxMatches: 2,
        maxLineLength: 30,
        contextLines: 2,
      },
    );
    const json = formatter.toJSON();

    assert.strictEqual(json.total, 3);
    assert.strictEqual(json.shown, 2);
    assert.strictEqual(json.omitted, 1);
    assert.strictEqual(json.matches[0].columnNumber, 21);
    assert.strictEqual(json.matches[0].lineContent, `${'a'.repeat(20)}cart...`);
    assert.doesNotMatch(JSON.stringify(json.matches[0].lineContent), /\ud83d/i);
    assert.deepStrictEqual(json.matches[0].contextBefore, []);
    assert.deepStrictEqual(json.matches[0].contextAfter, []);
  });

  it('truncates long context lines without splitting graphemes', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const longContext = `${'a'.repeat(12)}${family.repeat(10)}`;
    const formatter = new SearchMatchFormatter(
      {
        query: 'cart',
        matches: [
          {
            scriptId: '7',
            lineNumber: 2,
            lineContent: 'cart',
            sourceLines: [longContext, 'cart', longContext],
          },
        ],
      },
      {contextLines: 1, maxLineLength: 20},
    );
    const match = formatter.toJSON().matches[0];

    assert.deepStrictEqual(match.contextBefore, [
      truncateText(longContext, 20),
    ]);
    assert.deepStrictEqual(match.contextAfter, [truncateText(longContext, 20)]);
    for (const line of [...match.contextBefore, ...match.contextAfter]) {
      assert.doesNotMatch(JSON.stringify(line), /\ud83d/i);
    }
  });

  it('formats an empty match list', () => {
    const formatter = new SearchMatchFormatter({
      query: 'cart',
      matches: [],
    });

    assert.deepStrictEqual(formatter.toJSON(), {
      query: 'cart',
      total: 0,
      shown: 0,
      omitted: 0,
      matches: [],
    });
    assert.strictEqual(formatter.toString(), 'No matches for "cart".');
  });
});
