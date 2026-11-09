/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import type {DebuggerModelLike} from '../src/ScriptManager.js';
import {ScriptManager} from '../src/ScriptManager.js';
import type {DevTools} from '../src/third_party/index.js';
import './setupDevTools.js';

type ScriptId = DevTools.Protocol.Runtime.ScriptId;
type SourceResponse = DevTools.Protocol.Debugger.GetScriptSourceResponse;
type SearchResponse = DevTools.Protocol.Debugger.SearchInContentResponse;

interface MockScriptOptions {
  scriptId: ScriptId;
  url: string;
  length?: number;
  sourceMapURL?: string;
  isModule?: boolean | null;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

interface MockManager {
  manager: ScriptManager;
  model: {scripts: sinon.SinonStub};
  getScriptSource: sinon.SinonStub;
  searchInContent: sinon.SinonStub;
}

function createScriptId(value: string): ScriptId;
function createScriptId(value: string): string {
  return value;
}

function createMockScript(options: MockScriptOptions) {
  return {
    scriptId: options.scriptId,
    sourceURL: options.url,
    contentLength: options.length ?? 0,
    ...(options.sourceMapURL ? {sourceMapURL: options.sourceMapURL} : {}),
    isModule: options.isModule ?? null,
    lineOffset: options.startLine ?? 0,
    columnOffset: options.startColumn ?? 0,
    endLine: options.endLine ?? 0,
    endColumn: options.endColumn ?? 0,
  };
}

function sourceResponse(scriptSource: string): SourceResponse {
  return {scriptSource, getError: () => undefined};
}

function searchResponse(
  result: DevTools.Protocol.Debugger.SearchMatch[],
): SearchResponse {
  return {result, getError: () => undefined};
}

function createManager(
  scripts: Array<ReturnType<typeof createMockScript>>,
  options: {
    source?: SourceResponse;
    search?: SearchResponse | SearchResponse[];
  } = {},
): MockManager {
  const scriptsStub = sinon.stub().returns(scripts);
  const scriptForId = sinon
    .stub()
    .callsFake(
      scriptId => scripts.find(script => script.scriptId === scriptId) ?? null,
    );
  const getScriptSource = sinon.stub();
  getScriptSource.resolves(options.source ?? sourceResponse(''));
  const searchInContent = sinon.stub();
  if (Array.isArray(options.search)) {
    for (const response of options.search) {
      searchInContent.onCall(searchInContent.callCount).resolves(response);
    }
  }
  searchInContent.resolves(
    Array.isArray(options.search)
      ? searchResponse([])
      : (options.search ?? searchResponse([])),
  );
  const typedModel: DebuggerModelLike = {
    scripts: scriptsStub,
    scriptForId,
    agent: {
      invoke_getScriptSource: getScriptSource,
      invoke_searchInContent: searchInContent,
    },
  };
  return {
    manager: new ScriptManager(typedModel),
    model: {scripts: scriptsStub},
    getScriptSource,
    searchInContent,
  };
}

describe('ScriptManager', () => {
  it('lists bounded script summaries filtered by a URL suffix', async () => {
    const app = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/assets/app.js',
      length: 120,
      sourceMapURL: 'app.js.map',
      isModule: true,
      startLine: 4,
      startColumn: 2,
      endLine: 8,
      endColumn: 6,
    });
    const other = createMockScript({
      scriptId: createScriptId('2'),
      url: 'https://example.test/vendor.js',
      length: 900,
    });
    const later = createMockScript({
      scriptId: createScriptId('3'),
      url: 'https://example.test/assets/app.js?v=2',
      length: 130,
    });
    const {manager, model} = createManager([app, other, later]);

    const result = await manager.listScripts({
      urlFilter: 'assets/App.JS',
      maxScripts: 1,
    });

    sinon.assert.calledOnceWithExactly(model.scripts);
    assert.deepStrictEqual(result, {
      scripts: [
        {
          scriptId: '1',
          url: 'https://example.test/assets/app.js',
          length: 120,
          sourceMapURL: 'app.js.map',
          isModule: true,
          startLine: 5,
          startColumn: 3,
          endLine: 9,
          endColumn: 7,
        },
      ],
      total: 2,
      truncated: true,
    });
  });

  it('returns a 1-based line range and a bounded default preview', async () => {
    const source = Array.from({length: 120}, (_, i) => `line ${i + 1}`).join(
      '\n',
    );
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: source.length,
      endLine: 119,
    });
    const {manager, getScriptSource} = createManager([script], {
      source: sourceResponse(source),
    });

    const ranged = await manager.getScriptSource({
      scriptId: createScriptId('1'),
      startLine: 3,
      endLine: 5,
    });
    const preview = await manager.getScriptSource({
      scriptId: createScriptId('1'),
    });

    sinon.assert.calledTwice(getScriptSource);
    sinon.assert.calledWithExactly(getScriptSource.firstCall, {scriptId: '1'});
    sinon.assert.calledWithExactly(getScriptSource.secondCall, {scriptId: '1'});
    assert.deepStrictEqual(ranged, {
      scriptId: '1',
      url: 'https://example.test/app.js',
      startLine: 3,
      endLine: 5,
      totalLines: 120,
      byteLength: Buffer.byteLength(source, 'utf8'),
      lines: [
        {lineNumber: 3, text: 'line 3'},
        {lineNumber: 4, text: 'line 4'},
        {lineNumber: 5, text: 'line 5'},
      ],
      previewTruncated: false,
    });
    assert.strictEqual(preview.lines.length, 100);
    assert.strictEqual(preview.endLine, 100);
    assert.strictEqual(preview.previewTruncated, true);
  });

  it('truncates long preview lines without splitting graphemes', async () => {
    const emoji = '👩‍💻';
    const source = 'a'.repeat(499) + emoji + 'tail';
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: source.length,
      endLine: 0,
    });
    const {manager} = createManager([script], {
      source: sourceResponse(source),
    });

    const result = await manager.getScriptSource({
      scriptId: createScriptId('1'),
    });

    assert.strictEqual(result.lines.length, 1);
    assert.strictEqual(result.lines[0]?.text, 'a'.repeat(499) + '...');
    assert.doesNotMatch(JSON.stringify(result.lines[0]?.text), /\\ud83d/i);
  });

  it('exports source and search results while returning only summaries', async () => {
    const source = 'const answer = 42;\nconst other = 1;';
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: source.length,
      endLine: 1,
    });
    const search = searchResponse([
      {lineNumber: 0, lineContent: 'const answer = 42;'},
    ]);
    const {manager} = createManager([script], {
      source: sourceResponse(source),
      search,
    });
    const sourcePath = 'D:/tmp/script-source.js';
    const searchPath = 'D:/tmp/script-search.json';
    const writeFile = sinon.stub(fs, 'writeFile').resolves();

    const sourceResult = await manager.getScriptSource({
      scriptId: createScriptId('1'),
      filePath: sourcePath,
    });
    const searchResult = await manager.searchInScripts({
      query: 'answer',
      filePath: searchPath,
    });

    sinon.assert.calledTwice(writeFile);
    sinon.assert.calledWithExactly(
      writeFile.firstCall,
      sourcePath,
      `${source}\n`,
      'utf8',
    );
    sinon.assert.calledWithExactly(
      writeFile.secondCall,
      searchPath,
      `${JSON.stringify(searchResult.matches, null, 2)}\n`,
      'utf8',
    );
    assert.strictEqual(sourceResult.filePath, sourcePath);
    assert.deepStrictEqual(sourceResult.lines, [
      {lineNumber: 1, text: 'const answer = 42;'},
      {lineNumber: 2, text: 'const other = 1;'},
    ]);
    assert.strictEqual(searchResult.filePath, searchPath);
    assert.strictEqual(searchResult.matchCount, 1);
    assert.strictEqual(searchResult.matches.length, 1);
  });

  it('preserves the underlying filesystem error on source export', async () => {
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: 4,
      endLine: 0,
    });
    const {manager} = createManager([script], {
      source: sourceResponse('test'),
    });
    const error = new Error('EACCES: permission denied');
    sinon.stub(fs, 'writeFile').rejects(error);

    await assert.rejects(
      manager.getScriptSource({
        scriptId: createScriptId('1'),
        filePath: 'D:/tmp/script-source.js',
      }),
      error,
    );
  });

  it('derives columns from CDP SearchMatch lineContent and adds context', async () => {
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: 40,
      endLine: 2,
    });
    const search = searchResponse([
      {lineNumber: 0, lineContent: 'before'},
      {lineNumber: 1, lineContent: 'prefix needle suffix'},
      {lineNumber: 2, lineContent: 'after'},
    ]);
    const {manager, searchInContent} = createManager([script], {search});

    const result = await manager.searchInScripts({
      query: 'needle',
      contextLines: 1,
    });

    sinon.assert.calledOnceWithExactly(searchInContent, {
      scriptId: '1',
      query: 'needle',
      caseSensitive: false,
      isRegex: false,
    });
    assert.deepStrictEqual(result.matches, [
      {
        scriptId: '1',
        url: 'https://example.test/app.js',
        lineNumber: 2,
        columnNumber: 8,
        matchText: 'needle',
        lineContent: 'prefix needle suffix',
        contextLines: [
          {lineNumber: 1, text: 'before'},
          {lineNumber: 2, text: 'prefix needle suffix'},
          {lineNumber: 3, text: 'after'},
        ],
      },
    ]);
  });

  it('applies case sensitivity and regular expressions locally', async () => {
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: 40,
      endLine: 1,
    });
    const search = searchResponse([
      {lineNumber: 0, lineContent: 'Alpha alpha'},
      {lineNumber: 1, lineContent: 'beta42 beta7'},
    ]);
    const {manager, searchInContent} = createManager([script], {search});

    const caseSensitive = await manager.searchInScripts({
      query: 'alpha',
      caseSensitive: true,
    });
    const regex = await manager.searchInScripts({
      query: 'beta\\d+',
      isRegex: true,
    });

    sinon.assert.calledWithExactly(searchInContent.firstCall, {
      scriptId: '1',
      query: 'alpha',
      caseSensitive: true,
      isRegex: false,
    });
    sinon.assert.calledWithExactly(searchInContent.secondCall, {
      scriptId: '1',
      query: 'beta\\d+',
      caseSensitive: false,
      isRegex: true,
    });
    assert.deepStrictEqual(
      caseSensitive.matches.map(match => match.columnNumber),
      [7],
    );
    assert.deepStrictEqual(
      regex.matches.map(match => match.matchText),
      ['beta42', 'beta7'],
    );
  });

  it('excludes minified scripts before invoking CDP search', async () => {
    const normal = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: 100,
      endLine: 9,
    });
    const minified = createMockScript({
      scriptId: createScriptId('2'),
      url: 'https://example.test/bundle.min.js',
      length: 20_000,
      endLine: 0,
    });
    const {manager, searchInContent} = createManager([normal, minified], {
      search: searchResponse([
        {lineNumber: 0, lineContent: 'const answer = 1;'},
      ]),
    });

    const result = await manager.searchInScripts({
      query: 'answer',
      excludeMinified: true,
    });

    sinon.assert.calledOnceWithExactly(searchInContent, {
      scriptId: '1',
      query: 'answer',
      caseSensitive: false,
      isRegex: false,
    });
    assert.strictEqual(result.scannedScripts, 1);
    assert.strictEqual(result.matchCount, 1);
  });

  it('stops searching further scripts when maxMatches is reached', async () => {
    const first = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/one.js',
      length: 40,
      endLine: 0,
    });
    const second = createMockScript({
      scriptId: createScriptId('2'),
      url: 'https://example.test/two.js',
      length: 40,
      endLine: 0,
    });
    const {manager, searchInContent} = createManager([first, second], {
      search: searchResponse([{lineNumber: 0, lineContent: 'hit hit hit'}]),
    });

    const result = await manager.searchInScripts({
      query: 'hit',
      maxMatches: 2,
    });

    sinon.assert.calledOnceWithExactly(searchInContent, {
      scriptId: '1',
      query: 'hit',
      caseSensitive: false,
      isRegex: false,
    });
    assert.strictEqual(result.matchCount, 2);
    assert.strictEqual(result.scannedScripts, 1);
    assert.strictEqual(result.truncated, true);
  });

  it('does not enable a Debug Session or create another CDP session', async () => {
    const script = createMockScript({
      scriptId: createScriptId('1'),
      url: 'https://example.test/app.js',
      length: 4,
      endLine: 0,
    });
    const {manager, getScriptSource, searchInContent} = createManager(
      [script],
      {
        source: sourceResponse('test'),
        search: searchResponse([]),
      },
    );

    await manager.listScripts();
    await manager.getScriptSource({scriptId: createScriptId('1')});
    await manager.searchInScripts({query: 'test'});

    sinon.assert.calledOnceWithExactly(getScriptSource, {scriptId: '1'});
    sinon.assert.calledOnceWithExactly(searchInContent, {
      scriptId: '1',
      query: 'test',
      caseSensitive: false,
      isRegex: false,
    });
  });
});
