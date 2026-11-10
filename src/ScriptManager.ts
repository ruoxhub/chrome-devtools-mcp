/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

import type {TargetUniverse} from './devtools/DevtoolsUtils.js';
import {DevTools} from './third_party/index.js';
import {truncateText} from './utils/text.js';

const DEFAULT_MAX_SCRIPTS = 100;
const DEFAULT_PREVIEW_LINES = 100;
export const MAX_BOUND = 1_000;
const MAX_LINE_LENGTH = 500;
const DEFAULT_MAX_MATCHES = 100;
export const MAX_CONTEXT_LINES = 20;
const MINIFIED_LINE_THRESHOLD = 10_000;
const EXPORT_PREVIEW_LINES = 5;

type SearchMatch = DevTools.Protocol.Debugger.SearchMatch;
type ScriptId = DevTools.Protocol.Runtime.ScriptId;

interface ScriptLike {
  scriptId: ScriptId;
  sourceURL: string;
  lineOffset: number;
  columnOffset: number;
  endLine: number;
  endColumn: number;
  contentLength: number;
  sourceMapURL?: string;
  isModule: boolean | null;
}

interface DebuggerModelLike {
  scripts(): ScriptLike[];
  scriptForId(scriptId: string): ScriptLike | null;
  agent: Pick<
    DevTools.DebuggerModel['agent'],
    'invoke_getScriptSource' | 'invoke_searchInContent'
  >;
}

export type ScriptManagerSource = TargetUniverse | DebuggerModelLike;

export interface ScriptSummary {
  scriptId: string;
  url: string;
  length: number;
  sourceMapURL?: string;
  isModule: boolean | null;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ListScriptsOptions {
  urlFilter?: string;
  maxScripts?: number;
}

export interface ScriptListResult {
  scripts: ScriptSummary[];
  total: number;
  truncated: boolean;
}

export interface ScriptPreviewLine {
  lineNumber: number;
  text: string;
}

export interface GetScriptSourceOptions {
  scriptId: ScriptId;
  startLine?: number;
  endLine?: number;
  filePath?: string;
}

export interface ScriptSourceResult {
  scriptId: string;
  url: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  byteLength: number;
  lines: ScriptPreviewLine[];
  previewTruncated: boolean;
  filePath?: string;
}

export interface ScriptSearchMatch {
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber?: number;
  matchText: string;
  lineContent: string;
  contextLines: ScriptPreviewLine[];
}

export interface SearchInScriptsOptions {
  query: string;
  caseSensitive?: boolean;
  isRegex?: boolean;
  urlFilter?: string;
  contextLines?: number;
  maxMatches?: number;
  maxScripts?: number;
  excludeMinified?: boolean;
  filePath?: string;
}

interface ScriptSearchSummary {
  query: string;
  matchCount: number;
  scannedScripts: number;
  truncated: boolean;
}

export type ScriptSearchResult = ScriptSearchSummary &
  ({filePath: string} | {matches: ScriptSearchMatch[]; filePath?: undefined});

interface BoundedLines {
  lines: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

/**
 * Reads parsed scripts through the page's existing DebuggerModel without
 * changing pause settings or creating another CDP session.
 */
export class ScriptManager {
  readonly #model: DebuggerModelLike;

  constructor(source: ScriptManagerSource) {
    if (isDebuggerModelLike(source)) {
      this.#model = source;
      return;
    }
    const model = source.target.model(DevTools.DebuggerModel);
    if (!model) {
      throw new Error('The DevTools debugger model is not available.');
    }
    this.#model = model;
  }

  /**
   * Lists bounded script metadata; tool coordinates are 1-based.
   */
  listScripts(options: ListScriptsOptions = {}): ScriptListResult {
    const scripts = this.#model
      .scripts()
      .filter(script => matchesUrl(script.sourceURL, options.urlFilter));
    const limit = bound(options.maxScripts, DEFAULT_MAX_SCRIPTS);
    return {
      scripts: scripts.slice(0, limit).map(toScriptSummary),
      total: scripts.length,
      truncated: scripts.length > limit,
    };
  }

  /**
   * Reads a 1-based line range and returns only a bounded preview.
   */
  async getScriptSource(
    options: GetScriptSourceOptions,
  ): Promise<ScriptSourceResult> {
    const script = this.#requireScript(options.scriptId);
    const response = await this.#model.agent.invoke_getScriptSource({
      scriptId: script.scriptId,
    });
    const error = response.getError();
    if (error) {
      throw new Error(error);
    }
    const source = response.scriptSource;
    const exporting = options.filePath !== undefined;
    const previewLimit =
      options.startLine === undefined && options.endLine === undefined
        ? DEFAULT_PREVIEW_LINES
        : MAX_BOUND;
    const preview = selectLines(
      source,
      options.startLine,
      options.endLine,
      previewLimit,
    );
    const exported = exporting
      ? selectLines(source, options.startLine, options.endLine)
      : undefined;
    const previewCount = exporting ? EXPORT_PREVIEW_LINES : MAX_LINE_LENGTH;
    const lines: ScriptPreviewLine[] = preview.lines
      .slice(0, previewCount)
      .map((text, index) => ({
        lineNumber: preview.startLine + index,
        text: truncateText(text, MAX_LINE_LENGTH),
      }));
    if (options.filePath) {
      await fs.writeFile(
        toFilesystemPath(options.filePath),
        `${exported?.lines.join('\n') ?? ''}\n`,
        'utf8',
      );
    }
    return {
      scriptId: script.scriptId,
      url: script.sourceURL,
      startLine: exported?.startLine ?? preview.startLine,
      endLine: exported?.endLine ?? preview.endLine,
      totalLines: preview.totalLines,
      byteLength: Buffer.byteLength(source, 'utf8'),
      lines,
      previewTruncated:
        (exporting ? false : preview.truncated) ||
        (exported?.lines.length ?? preview.lines.length) > lines.length,
      ...(options.filePath ? {filePath: options.filePath} : {}),
    };
  }

  /**
   * Searches CDP results across bounded scripts and derives columns locally.
   */
  async searchInScripts(
    options: SearchInScriptsOptions,
  ): Promise<ScriptSearchResult> {
    const query = options.query;
    const caseSensitive = options.caseSensitive ?? false;
    const isRegex = options.isRegex ?? false;
    const pattern = createPattern(query, caseSensitive, isRegex);
    const maxMatches = bound(options.maxMatches, DEFAULT_MAX_MATCHES);
    const contextLines = Math.min(
      Math.max(0, options.contextLines ?? 0),
      MAX_CONTEXT_LINES,
    );
    const scripts = this.#model
      .scripts()
      .filter(script => matchesUrl(script.sourceURL, options.urlFilter))
      .filter(script => !options.excludeMinified || !isMinified(script))
      .slice(0, bound(options.maxScripts, DEFAULT_MAX_SCRIPTS));
    const matches: ScriptSearchMatch[] = [];
    let scannedScripts = 0;

    for (const script of scripts) {
      if (matches.length >= maxMatches) {
        break;
      }
      scannedScripts++;
      let response: {result: SearchMatch[]; getError(): string | undefined};
      try {
        response = await this.#model.agent.invoke_searchInContent({
          scriptId: script.scriptId,
          query,
          caseSensitive,
          isRegex,
        });
      } catch (error) {
        if (isStaleScriptError(error)) {
          continue;
        }
        throw error;
      }
      const error = response.getError();
      if (error) {
        if (isStaleScriptError(error)) {
          continue;
        }
        throw new Error(error);
      }
      const byLine = new Map<number, string>();
      for (const result of response.result) {
        byLine.set(result.lineNumber, result.lineContent);
      }
      for (const result of response.result) {
        if (matches.length >= maxMatches) {
          break;
        }
        const lineMatches = [...result.lineContent.matchAll(pattern)];
        for (const lineMatch of lineMatches) {
          if (matches.length >= maxMatches) {
            break;
          }
          if (lineMatch.index === undefined) {
            continue;
          }
          matches.push({
            scriptId: script.scriptId,
            url: script.sourceURL,
            lineNumber: result.lineNumber + 1,
            columnNumber: lineMatch.index + 1,
            matchText: lineMatch[0],
            lineContent: truncateText(result.lineContent, MAX_LINE_LENGTH),
            contextLines: buildContext(byLine, result.lineNumber, contextLines),
          });
        }
      }
    }

    const summary: ScriptSearchSummary = {
      query,
      matchCount: matches.length,
      scannedScripts,
      truncated: matches.length >= maxMatches,
    };
    if (options.filePath) {
      await fs.writeFile(
        toFilesystemPath(options.filePath),
        `${JSON.stringify(matches, null, 2)}\n`,
        'utf8',
      );
      return {...summary, filePath: options.filePath};
    }
    return {...summary, matches};
  }

  #requireScript(scriptId: string): ScriptLike {
    const script = this.#model.scriptForId(scriptId);
    if (!script) {
      throw new Error(`Script ${scriptId} was not found.`);
    }
    return script;
  }
}

function isDebuggerModelLike(
  source: ScriptManagerSource,
): source is DebuggerModelLike {
  return 'scripts' in source;
}

function bound(value: number | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_BOUND));
}

function toFilesystemPath(pathOrUrl: string): string {
  return pathOrUrl.startsWith('file:') ? fileURLToPath(pathOrUrl) : pathOrUrl;
}

function matchesUrl(url: string, urlFilter: string | undefined): boolean {
  if (!urlFilter) {
    return true;
  }
  const filter = urlFilter.toLowerCase();
  const candidate = url.toLowerCase();
  return candidate.includes(filter) || candidate.endsWith('/' + filter);
}

function toScriptSummary(script: ScriptLike): ScriptSummary {
  return {
    scriptId: script.scriptId,
    url: script.sourceURL,
    length: script.contentLength,
    ...(script.sourceMapURL ? {sourceMapURL: script.sourceMapURL} : {}),
    isModule: script.isModule,
    startLine: script.lineOffset + 1,
    startColumn: script.columnOffset + 1,
    endLine: script.endLine + 1,
    endColumn: script.endColumn + 1,
  };
}

function selectLines(
  source: string,
  requestedStart: number | undefined,
  requestedEnd: number | undefined,
  previewLimit = Number.MAX_SAFE_INTEGER,
): BoundedLines {
  const lines = source.split(/\r\n|\n|\r/);
  const start = Math.max(1, requestedStart ?? 1);
  const requestedLast =
    requestedEnd === undefined ? lines.length : Math.max(start, requestedEnd);
  const end = Math.min(requestedLast, start + previewLimit - 1, lines.length);
  const selected = lines.slice(start - 1, end);
  return {
    lines: selected,
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    truncated: end < Math.min(requestedLast, lines.length),
  };
}

function createPattern(
  query: string,
  caseSensitive: boolean,
  isRegex: boolean,
): RegExp {
  const flags = caseSensitive ? 'g' : 'gi';
  if (isRegex) {
    try {
      return new RegExp(query, flags);
    } catch {
      return DevTools.Platform.StringUtilities.createSearchRegex(
        query,
        caseSensitive,
        false,
      );
    }
  }
  return DevTools.Platform.StringUtilities.createSearchRegex(
    query,
    caseSensitive,
    false,
  );
}

/**
 * A script reported by the debugger model can disappear between listing and
 * searching, for example after a navigation. Searching the remaining scripts
 * is still useful, so a stale id is skipped rather than failing the call.
 */
function isStaleScriptError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /No script for id/i.test(text);
}

function isMinified(script: ScriptLike): boolean {
  const lineCount = script.endLine - script.lineOffset + 1;
  return (
    lineCount > 0 && script.contentLength / lineCount > MINIFIED_LINE_THRESHOLD
  );
}

function buildContext(
  byLine: Map<number, string>,
  lineNumber: number,
  contextLines: number,
): ScriptPreviewLine[] {
  if (contextLines === 0) {
    return [];
  }
  const context: ScriptPreviewLine[] = [];
  for (
    let line = Math.max(0, lineNumber - contextLines);
    line <= lineNumber + contextLines;
    line++
  ) {
    const candidate = byLine.get(line);
    if (candidate === undefined) {
      continue;
    }
    context.push({
      lineNumber: line + 1,
      text: truncateText(candidate, MAX_LINE_LENGTH),
    });
  }
  return context;
}

export type {DebuggerModelLike, ScriptLike, SearchMatch};
