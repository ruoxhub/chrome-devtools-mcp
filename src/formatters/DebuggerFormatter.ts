/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ObjectPropertiesView,
  ObjectPropertyView,
  RemoteObjectLike,
} from '../DebuggerController.js';
import type {ScriptListResult, ScriptSourceResult} from '../ScriptManager.js';
import {DevTools, type Protocol} from '../third_party/index.js';
import {truncateText} from '../utils/text.js';
import {formatRemoteObject} from './RemoteObjectFormatter.js';

export interface DebuggerLocation {
  url?: string;
  scriptId?: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface BreakpointRecord {
  breakpointId: string;
  requested: DebuggerLocation;
  resolved: readonly DebuggerLocation[];
  condition?: string;
  bound: boolean;
}

export interface BreakpointFormatterOptions {
  maxBreakpoints?: number;
}

export interface FormattedBreakpoint {
  breakpointId: string;
  requested: string;
  resolved: string[];
  condition: string | undefined;
  bound: boolean;
}

export interface BreakpointFormatterResult {
  total: number;
  shown: number;
  omitted: number;
  breakpoints: FormattedBreakpoint[];
}

const DEFAULT_MAX_BREAKPOINTS = 100;

function formatLocation(location: DebuggerLocation): string {
  const source = location.url ?? `script ${location.scriptId ?? 'unknown'}`;
  return `${source}:${location.lineNumber}${
    location.columnNumber === undefined ? '' : `:${location.columnNumber}`
  }`;
}

function formatBreakpoint(breakpoint: FormattedBreakpoint): string {
  const status = breakpoint.bound ? 'bound' : 'not bound';
  const lines = [
    `- ${breakpoint.breakpointId} at ${breakpoint.requested} [${status}]${
      breakpoint.condition === undefined
        ? ''
        : ` condition: ${breakpoint.condition}`
    }`,
  ];
  if (breakpoint.resolved.length > 0) {
    lines.push(`  resolved: ${breakpoint.resolved.join(', ')}`);
  }
  return lines.join('\n');
}

function formatBreakpoints(result: BreakpointFormatterResult): string {
  if (result.total === 0) {
    return 'No breakpoints are set.';
  }
  const lines = [
    result.omitted === 0
      ? `${result.shown} breakpoint(s):`
      : `${result.shown} of ${result.total} breakpoint(s):`,
  ];
  for (const breakpoint of result.breakpoints) {
    lines.push(formatBreakpoint(breakpoint));
  }
  if (result.omitted > 0) {
    lines.push(`${result.omitted} more breakpoint(s) omitted`);
  }
  return lines.join('\n');
}

export class BreakpointFormatter {
  readonly #records: readonly BreakpointRecord[];
  readonly #maxBreakpoints: number;

  constructor(
    records: readonly BreakpointRecord[],
    options: BreakpointFormatterOptions = {},
  ) {
    this.#records = records;
    this.#maxBreakpoints = options.maxBreakpoints ?? DEFAULT_MAX_BREAKPOINTS;
  }

  toJSON(): BreakpointFormatterResult {
    const breakpoints: FormattedBreakpoint[] = [];
    for (const record of this.#records.slice(0, this.#maxBreakpoints)) {
      breakpoints.push({
        breakpointId: record.breakpointId,
        requested: formatLocation(record.requested),
        resolved: record.resolved.map(formatLocation),
        condition: record.condition,
        bound: record.bound,
      });
    }
    return {
      total: this.#records.length,
      shown: breakpoints.length,
      omitted: this.#records.length - breakpoints.length,
      breakpoints,
    };
  }

  toString(): string {
    return formatBreakpoints(this.toJSON());
  }
}

export interface PausedCallFrame {
  functionName: string;
  url?: string;
  scriptId?: string;
  lineNumber: number;
  columnNumber: number;
}

export interface PausedState {
  reason: string;
  hitBreakpoints: readonly string[];
  callFrames: readonly PausedCallFrame[];
}

export interface PausedStateFormatterOptions {
  maxCallFrames?: number;
  maxHitBreakpoints?: number;
}

export interface FormattedPausedCallFrame {
  functionName: string;
  location: string;
}

export interface PausedStateFormatterResult {
  reason: string;
  hitBreakpoints: string[];
  callFrameTotal: number;
  callFrameOmitted: number;
  callFrames: FormattedPausedCallFrame[];
}

const DEFAULT_MAX_CALL_FRAMES = 50;
const DEFAULT_MAX_HIT_BREAKPOINTS = 20;

function formatPausedState(result: PausedStateFormatterResult): string {
  const lines = [`Paused: ${result.reason}`];
  if (result.hitBreakpoints.length > 0) {
    lines.push(`hit breakpoints: ${result.hitBreakpoints.join(', ')}`);
  }
  if (result.callFrames.length > 0) {
    lines.push('call frames:');
    for (const frame of result.callFrames) {
      lines.push(`  ${frame.functionName} at ${frame.location}`);
    }
  }
  if (result.callFrameOmitted > 0) {
    lines.push(`${result.callFrameOmitted} more call frame(s) omitted`);
  }
  return lines.join('\n');
}

export class PausedStateFormatter {
  readonly #state: PausedState;
  readonly #maxCallFrames: number;
  readonly #maxHitBreakpoints: number;

  constructor(state: PausedState, options: PausedStateFormatterOptions = {}) {
    this.#state = state;
    this.#maxCallFrames = options.maxCallFrames ?? DEFAULT_MAX_CALL_FRAMES;
    this.#maxHitBreakpoints =
      options.maxHitBreakpoints ?? DEFAULT_MAX_HIT_BREAKPOINTS;
  }

  toJSON(): PausedStateFormatterResult {
    const callFrames: FormattedPausedCallFrame[] = [];
    for (const frame of this.#state.callFrames.slice(0, this.#maxCallFrames)) {
      callFrames.push({
        functionName: frame.functionName,
        location: formatLocation({
          url: frame.url,
          scriptId: frame.scriptId,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        }),
      });
    }
    return {
      reason: this.#state.reason,
      hitBreakpoints: this.#state.hitBreakpoints
        .slice(0, this.#maxHitBreakpoints)
        .map(id => id),
      callFrameTotal: this.#state.callFrames.length,
      callFrameOmitted: this.#state.callFrames.length - callFrames.length,
      callFrames,
    };
  }

  toString(): string {
    return formatPausedState(this.toJSON());
  }
}

export interface ScopeProperty {
  name: string;
  value?: Protocol.Runtime.RemoteObject;
  children?: readonly ScopeProperty[];
}

export interface ScopeRecord {
  type: string;
  name?: string;
  object?: Protocol.Runtime.RemoteObject;
  properties: readonly ScopeProperty[];
}

export interface ScopeSummary {
  scopes: readonly ScopeRecord[];
  properties: readonly ScopeProperty[];
}

export interface ScopeSummaryFormatterOptions {
  maxDepth?: number;
  maxScopes?: number;
  maxPropertiesPerScope?: number;
  maxProperties?: number;
}

export interface FormattedScopeProperty {
  name: string;
  value: string | undefined;
  omittedChildren?: number;
  children?: FormattedScopeProperty[];
}

export interface FormattedScope {
  type: string;
  name: string | undefined;
  object: string | undefined;
  properties: FormattedScopeProperty[];
  omittedProperties: number;
}

export interface ScopeSummaryFormatterResult {
  scopes: FormattedScope[];
  properties: FormattedScopeProperty[];
  scopeTotal: number;
  scopeOmitted: number;
  propertyOmitted: number;
}

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_SCOPES = 20;
const DEFAULT_MAX_PROPERTIES_PER_SCOPE = 20;
const DEFAULT_MAX_PROPERTIES = 100;

function formatProperty(
  property: ScopeProperty,
  maxDepth: number,
  maxChildren: number,
  depth: number,
): FormattedScopeProperty {
  const formatted: FormattedScopeProperty = {
    name: property.name,
    value: property.value ? formatRemoteObject(property.value) : undefined,
  };
  const children = property.children ?? [];
  if (children.length === 0) {
    return formatted;
  }
  const bounded = children.slice(0, depth >= maxDepth ? 0 : maxChildren);
  formatted.omittedChildren = children.length - bounded.length;
  if (depth < maxDepth) {
    formatted.children = bounded.map(child => {
      return formatProperty(child, maxDepth, maxChildren, depth + 1);
    });
  }
  return formatted;
}

function formatPropertyLine(
  property: FormattedScopeProperty,
  indent: string,
): string {
  const omitted =
    property.omittedChildren === undefined || property.omittedChildren === 0
      ? ''
      : ` (${property.omittedChildren} nested omitted)`;
  return `${indent}${property.name} = ${
    property.value ?? '(unavailable)'
  }${omitted}`;
}

function formatPropertyLines(
  properties: readonly FormattedScopeProperty[],
  indent: string,
): string[] {
  const lines: string[] = [];
  for (const property of properties) {
    lines.push(formatPropertyLine(property, indent));
    if (property.children) {
      lines.push(...formatPropertyLines(property.children, `${indent}  `));
    }
  }
  return lines;
}

function formatScopeLine(scope: FormattedScope): string {
  const heading = scope.name
    ? `${scope.type} "${scope.name}"`
    : scope.object
      ? `${scope.type} (${scope.object})`
      : scope.type;
  const values = scope.properties.map(property => {
    return `${property.name} = ${property.value ?? '(unavailable)'}`;
  });
  const suffix =
    scope.omittedProperties > 0 ? ` (${scope.omittedProperties} more)` : '';
  const lines = [`  ${heading}: ${values.join(', ')}${suffix}`];
  for (const property of scope.properties) {
    if (property.children) {
      lines.push(...formatPropertyLines(property.children, '    '));
    }
  }
  return lines.join('\n');
}

function formatScopeSummary(result: ScopeSummaryFormatterResult): string {
  if (
    result.scopes.length === 0 &&
    result.properties.length === 0 &&
    result.scopeOmitted === 0 &&
    result.propertyOmitted === 0
  ) {
    return 'No scopes or properties.';
  }
  const lines: string[] = [];
  if (result.scopes.length > 0) {
    lines.push('scopes:');
    for (const scope of result.scopes) {
      lines.push(formatScopeLine(scope));
    }
  }
  if (result.scopeOmitted > 0) {
    lines.push(`${result.scopeOmitted} more scope(s) omitted`);
  }
  if (result.properties.length > 0) {
    lines.push('properties:');
    lines.push(...formatPropertyLines(result.properties, '  '));
  }
  if (result.propertyOmitted > 0) {
    lines.push(`${result.propertyOmitted} more property omitted`);
  }
  return lines.join('\n');
}

export class ScopeSummaryFormatter {
  readonly #summary: ScopeSummary;
  readonly #maxDepth: number;
  readonly #maxScopes: number;
  readonly #maxPropertiesPerScope: number;
  readonly #maxProperties: number;

  constructor(
    summary: ScopeSummary,
    options: ScopeSummaryFormatterOptions = {},
  ) {
    this.#summary = summary;
    this.#maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.#maxScopes = options.maxScopes ?? DEFAULT_MAX_SCOPES;
    this.#maxPropertiesPerScope =
      options.maxPropertiesPerScope ?? DEFAULT_MAX_PROPERTIES_PER_SCOPE;
    this.#maxProperties = options.maxProperties ?? DEFAULT_MAX_PROPERTIES;
  }

  toJSON(): ScopeSummaryFormatterResult {
    const scopes: FormattedScope[] = [];
    for (const scope of this.#summary.scopes.slice(0, this.#maxScopes)) {
      const properties: FormattedScopeProperty[] = [];
      for (const property of scope.properties.slice(
        0,
        this.#maxPropertiesPerScope,
      )) {
        properties.push(
          formatProperty(
            property,
            this.#maxDepth,
            this.#maxPropertiesPerScope,
            1,
          ),
        );
      }
      scopes.push({
        type: scope.type,
        name: scope.name,
        object: scope.object ? formatRemoteObject(scope.object) : undefined,
        properties,
        omittedProperties: scope.properties.length - properties.length,
      });
    }
    const properties: FormattedScopeProperty[] = [];
    for (const property of this.#summary.properties.slice(
      0,
      this.#maxProperties,
    )) {
      properties.push(
        formatProperty(
          property,
          this.#maxDepth,
          this.#maxPropertiesPerScope,
          1,
        ),
      );
    }
    return {
      scopes,
      properties,
      scopeTotal: this.#summary.scopes.length,
      scopeOmitted: this.#summary.scopes.length - scopes.length,
      propertyOmitted: this.#summary.properties.length - properties.length,
    };
  }

  toString(): string {
    return formatScopeSummary(this.toJSON());
  }
}

export interface EvaluationResult {
  result?: Protocol.Runtime.RemoteObject;
  exceptionDetails?: Protocol.Runtime.ExceptionDetails;
}

export interface EvaluationResultFormatterResult {
  result: string | undefined;
  exception: string | undefined;
}

function formatException(details: Protocol.Runtime.ExceptionDetails): string {
  const description = details.exception
    ? `: ${formatRemoteObject(details.exception)}`
    : '';
  return `${details.text}${description}`;
}

function formatEvaluationResult(
  formatted: EvaluationResultFormatterResult,
): string {
  if (formatted.result !== undefined) {
    return `Result: ${formatted.result}`;
  }
  if (formatted.exception !== undefined) {
    return `Exception: ${formatted.exception}`;
  }
  return 'No evaluation result.';
}

export class EvaluationResultFormatter {
  readonly #result: EvaluationResult;

  constructor(result: EvaluationResult) {
    this.#result = result;
  }

  toJSON(): EvaluationResultFormatterResult {
    return {
      result: this.#result.result
        ? formatRemoteObject(this.#result.result)
        : undefined,
      exception: this.#result.exceptionDetails
        ? formatException(this.#result.exceptionDetails)
        : undefined,
    };
  }

  toString(): string {
    return formatEvaluationResult(this.toJSON());
  }
}

export interface SearchMatchRecord {
  scriptId: string;
  url?: string;
  lineNumber: number;
  lineContent: string;
  sourceLines?: readonly string[];
}

export interface SearchMatches {
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  matches: readonly SearchMatchRecord[];
}

export interface SearchMatchFormatterOptions {
  contextLines?: number;
  maxMatches?: number;
  maxLineLength?: number;
}

export interface FormattedSearchMatch {
  scriptId: string;
  url: string | undefined;
  lineNumber: number;
  columnNumber: number | undefined;
  lineContent: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface SearchMatchFormatterResult {
  query: string;
  total: number;
  shown: number;
  omitted: number;
  matches: FormattedSearchMatch[];
}

const DEFAULT_CONTEXT_LINES = 2;
const DEFAULT_MAX_MATCHES = 50;
const DEFAULT_MAX_LINE_LENGTH = 500;
const MAX_REGEX_INPUT_LENGTH = 2_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatch(
  line: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): RegExpMatchArray | undefined {
  const bounded = truncateText(line, MAX_REGEX_INPUT_LENGTH);
  try {
    const pattern = isRegex ? query : escapeRegExp(query);
    const flags = caseSensitive ? '' : 'i';
    return bounded.match(new RegExp(pattern, flags)) ?? undefined;
  } catch {
    return undefined;
  }
}

function columnNumber(
  line: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): number | undefined {
  const match = findMatch(line, query, isRegex, caseSensitive);
  return match?.index === undefined ? undefined : match.index + 1;
}

function contextLines(
  match: SearchMatchRecord,
  maxContextLines: number,
  maxLineLength: number,
): {before: string[]; after: string[]} {
  const before: string[] = [];
  const after: string[] = [];
  const lines = match.sourceLines ?? [];
  const index = lines.indexOf(match.lineContent);
  if (index < 0) {
    return {before, after};
  }
  const start = Math.max(0, index - maxContextLines);
  const end = Math.min(lines.length, index + maxContextLines + 1);
  for (const source of lines.slice(start, index)) {
    before.push(truncateText(source, maxLineLength));
  }
  for (const source of lines.slice(index + 1, end)) {
    after.push(truncateText(source, maxLineLength));
  }
  return {before, after};
}

function formatSearchMatch(match: FormattedSearchMatch): string {
  const source = match.url
    ? `script ${match.scriptId} ${match.url}`
    : `script ${match.scriptId}`;
  const column = match.columnNumber ?? '?';
  const lines = [`${source}:${match.lineNumber}:${column}`];
  for (const line of match.contextBefore) {
    lines.push(`  context: ${line}`);
  }
  lines.push(`  line: ${match.lineContent}`);
  for (const line of match.contextAfter) {
    lines.push(`  context: ${line}`);
  }
  return lines.join('\n');
}

function formatSearchMatches(result: SearchMatchFormatterResult): string {
  if (result.total === 0) {
    return `No matches for "${result.query}".`;
  }
  const lines = [
    `${result.shown} of ${result.total} match(es) for "${result.query}":`,
  ];
  for (const match of result.matches) {
    lines.push(formatSearchMatch(match));
  }
  if (result.omitted > 0) {
    lines.push(`${result.omitted} more match(es) omitted`);
  }
  return lines.join('\n');
}

export interface FormattedObjectProperty {
  name: string;
  value: string;
}

export interface ObjectPropertiesFormatterResult {
  objectId: string;
  generation: number;
  properties: FormattedObjectProperty[];
  truncated: boolean;
}

function toProtocolRemoteObjectType(
  type: string,
): DevTools.Protocol.Runtime.RemoteObjectType {
  switch (type) {
    case 'object':
      return DevTools.Protocol.Runtime.RemoteObjectType.Object;
    case 'function':
      return DevTools.Protocol.Runtime.RemoteObjectType.Function;
    case 'undefined':
      return DevTools.Protocol.Runtime.RemoteObjectType.Undefined;
    case 'string':
      return DevTools.Protocol.Runtime.RemoteObjectType.String;
    case 'number':
      return DevTools.Protocol.Runtime.RemoteObjectType.Number;
    case 'boolean':
      return DevTools.Protocol.Runtime.RemoteObjectType.Boolean;
    case 'symbol':
      return DevTools.Protocol.Runtime.RemoteObjectType.Symbol;
    case 'bigint':
      return DevTools.Protocol.Runtime.RemoteObjectType.Bigint;
    default:
      return DevTools.Protocol.Runtime.RemoteObjectType.Undefined;
  }
}

export function toProtocolRemoteObject(
  object: RemoteObjectLike,
): Protocol.Runtime.RemoteObject {
  const result: Protocol.Runtime.RemoteObject = {
    type: toProtocolRemoteObjectType(object.type),
  };
  if (object.description !== undefined) {
    result.description = object.description;
  }
  if (object.value !== undefined) {
    result.value = object.value;
  }
  return result;
}

function formatRemoteObjectForTool(
  object: Protocol.Runtime.RemoteObject,
): string {
  if (object.description !== undefined) {
    return object.description;
  }
  if (object.unserializableValue !== undefined) {
    return object.unserializableValue;
  }
  if (object.value === undefined) {
    return 'undefined';
  }
  return String(object.value);
}

function formatObjectProperty(property: ObjectPropertyView): string {
  const value = property.value
    ? toProtocolRemoteObject(property.value)
    : undefined;
  return value ? formatRemoteObjectForTool(value) : '(unavailable)';
}

function formatObjectProperties(
  result: ObjectPropertiesFormatterResult,
): string {
  const lines = [`${result.objectId} (generation ${result.generation}):`];
  for (const property of result.properties) {
    lines.push(`  ${property.name} = ${property.value}`);
  }
  if (result.truncated) {
    lines.push('  more properties omitted');
  }
  return lines.join('\n');
}

export class ObjectPropertiesFormatter {
  readonly #view: ObjectPropertiesView;

  constructor(view: ObjectPropertiesView) {
    this.#view = view;
  }

  toJSON(): ObjectPropertiesFormatterResult {
    return {
      objectId: this.#view.objectId,
      generation: this.#view.generation,
      properties: this.#view.properties.map(property => ({
        name: property.name,
        value: formatObjectProperty(property),
      })),
      truncated: this.#view.truncated,
    };
  }

  toString(): string {
    return formatObjectProperties(this.toJSON());
  }
}

export interface FormattedScriptSummary {
  scriptId: string;
  url: string;
  length: number;
  startLine: number;
  endLine: number;
}

export interface ScriptListFormatterResult {
  total: number;
  truncated: boolean;
  scripts: FormattedScriptSummary[];
}

function formatScriptList(result: ScriptListFormatterResult): string {
  const lines = [`${result.scripts.length} script(s) (total ${result.total}):`];
  for (const script of result.scripts) {
    lines.push(
      `- ${script.scriptId} ${script.url} (${script.length} bytes, lines ${script.startLine}-${script.endLine})`,
    );
  }
  if (result.truncated) {
    lines.push('more script(s) omitted');
  }
  return lines.join('\n');
}

export class ScriptListFormatter {
  readonly #list: ScriptListResult;

  constructor(list: ScriptListResult) {
    this.#list = list;
  }

  toJSON(): ScriptListFormatterResult {
    return {
      total: this.#list.total,
      truncated: this.#list.truncated,
      scripts: this.#list.scripts.map(script => ({
        scriptId: script.scriptId,
        url: script.url,
        length: script.length,
        startLine: script.startLine,
        endLine: script.endLine,
      })),
    };
  }

  toString(): string {
    return formatScriptList(this.toJSON());
  }
}

export interface ScriptSourceFormatterResult {
  scriptId: string;
  url: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  byteLength: number;
  lines: ReadonlyArray<ScriptSourceResult['lines'][number]>;
  previewTruncated: boolean;
  filePath?: string;
}

function formatScriptSource(result: ScriptSourceFormatterResult): string {
  const lines = [
    `Script ${result.scriptId} ${result.url} lines ${result.startLine}-${result.endLine} of ${result.totalLines} (${result.byteLength} bytes):`,
  ];
  for (const line of result.lines) {
    lines.push(`  ${line.lineNumber}: ${line.text}`);
  }
  if (result.previewTruncated) {
    lines.push('more preview line(s) omitted');
  }
  if (result.filePath !== undefined) {
    lines.push(`Exported to ${result.filePath}.`);
  }
  return lines.join('\n');
}

export class ScriptSourceFormatter {
  readonly #source: ScriptSourceResult;

  constructor(source: ScriptSourceResult) {
    this.#source = source;
  }

  toJSON(): ScriptSourceFormatterResult {
    const result: ScriptSourceFormatterResult = {
      scriptId: this.#source.scriptId,
      url: this.#source.url,
      startLine: this.#source.startLine,
      endLine: this.#source.endLine,
      totalLines: this.#source.totalLines,
      byteLength: this.#source.byteLength,
      lines: [...this.#source.lines],
      previewTruncated: this.#source.previewTruncated,
    };
    if (this.#source.filePath !== undefined) {
      result.filePath = this.#source.filePath;
    }
    return result;
  }

  toString(): string {
    return formatScriptSource(this.toJSON());
  }
}

export class SearchMatchFormatter {
  readonly #data: SearchMatches;
  readonly #contextLines: number;
  readonly #maxMatches: number;
  readonly #maxLineLength: number;

  constructor(data: SearchMatches, options: SearchMatchFormatterOptions = {}) {
    this.#data = data;
    this.#contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
    this.#maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
    this.#maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  }

  toJSON(): SearchMatchFormatterResult {
    const matches: FormattedSearchMatch[] = [];
    for (const match of this.#data.matches.slice(0, this.#maxMatches)) {
      const context = contextLines(
        match,
        this.#contextLines,
        this.#maxLineLength,
      );
      matches.push({
        scriptId: match.scriptId,
        url: match.url,
        lineNumber: match.lineNumber,
        columnNumber: columnNumber(
          match.lineContent,
          this.#data.query,
          this.#data.isRegex ?? false,
          this.#data.caseSensitive ?? false,
        ),
        lineContent: truncateText(match.lineContent, this.#maxLineLength),
        contextBefore: context.before,
        contextAfter: context.after,
      });
    }
    return {
      query: this.#data.query,
      total: this.#data.matches.length,
      shown: matches.length,
      omitted: this.#data.matches.length - matches.length,
      matches,
    };
  }

  toString(): string {
    return formatSearchMatches(this.toJSON());
  }
}
