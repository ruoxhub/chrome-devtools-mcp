/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BreakpointRecord,
  EvaluationResultLike,
  EvaluateOnCallFrameOptions,
  GetObjectPropertiesOptions,
  ObjectPropertyView,
  ObjectPropertiesView,
  PausedSnapshot,
  PausedStateView,
  PauseResult,
  PendingPauseResult,
  RemoteObjectLike,
  SetBreakpointOptions,
} from '../DebuggerController.js';
import {
  BreakpointFormatter,
  EvaluationResultFormatter,
  PausedStateFormatter,
  SearchMatchFormatter,
  type DebuggerLocation,
  type EvaluationResult,
  type PausedCallFrame,
  type SearchMatchRecord,
} from '../formatters/DebuggerFormatter.js';
import type {
  ListScriptsOptions,
  ScriptListResult,
  ScriptSearchMatch,
  ScriptSearchResult,
  ScriptSourceResult,
  SearchInScriptsOptions,
} from '../ScriptManager.js';
import {DevTools, zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {
  definePageTool,
  type ContextPage,
  type PageToolFactory,
  type Response,
  type Context,
} from './ToolDefinition.js';

const DEFAULT_WAIT_TIMEOUT = 10_000;
const MAX_WAIT_TIMEOUT = 30_000;
const MAX_CONTEXT_LINES = 20;
const MAX_BOUND = 1_000;

type DebuggerPage = ContextPage &
  Readonly<{
    setBreakpoint(options: SetBreakpointOptions): Promise<BreakpointRecord>;
    listBreakpoints(): readonly BreakpointRecord[];
    removeBreakpoint(breakpointId: string): Promise<boolean>;
    pause(options?: {
      timeout?: number;
    }): Promise<PauseResult | PendingPauseResult>;
    resume(): Promise<void>;
    step(
      direction: 'into' | 'over' | 'out',
      options?: {timeout?: number},
    ): Promise<PauseResult>;
    disable(): void;
    waitForPaused(options?: {timeout?: number}): Promise<PausedSnapshot>;
    getPausedState(options?: {includeScopes?: boolean}): PausedStateView;
    evaluateOnCallFrame(
      options: EvaluateOnCallFrameOptions,
    ): Promise<EvaluationResultLike>;
    getObjectProperties(
      options: GetObjectPropertiesOptions,
    ): Promise<ObjectPropertiesView>;
    listScripts(options?: ListScriptsOptions): ScriptListResult;
    getScriptSource(options: {
      scriptId: string;
      startLine?: number;
      endLine?: number;
      filePath?: string;
    }): Promise<ScriptSourceResult>;
    searchInScripts(
      options: SearchInScriptsOptions,
    ): Promise<ScriptSearchResult>;
  }>;

interface DebuggerRequest<Schema extends Record<string, zod.ZodType>> {
  params: Parameters<
    PageToolDefinitionWithSchema<Schema>['handler']
  >[0]['params'];
  page: DebuggerPage;
}

type PageToolDefinitionWithSchema<Schema extends Record<string, zod.ZodType>> =
  Parameters<typeof definePageTool<Schema>>[0] extends (
    args: Parameters<PageToolFactory>[0],
  ) => infer Definition
    ? Definition
    : never;

type DebuggerToolFactory = (
  args: Parameters<PageToolFactory>[0],
) => ReturnType<PageToolFactory>;

function defineDebuggerTool<Schema extends Record<string, zod.ZodType>>(
  definition: (args: Parameters<PageToolFactory>[0]) => Omit<
    PageToolDefinitionWithSchema<Schema>,
    'handler'
  > & {
    verifyFilesSchema: Partial<
      Record<keyof Schema, true | {local?: boolean; remote?: boolean}>
    >;
    handler(
      request: DebuggerRequest<Schema>,
      response: Response,
      context: Context,
    ): Promise<void>;
  },
): DebuggerToolFactory {
  return definePageTool(definition);
}

function optionalString(description: string): zod.ZodOptional<zod.ZodString> {
  return zod.string().optional().describe(description);
}

function optionalBoolean(description: string): zod.ZodOptional<zod.ZodBoolean> {
  return zod.boolean().optional().describe(description);
}

function positiveInteger(description: string): zod.ZodNumber {
  return zod.number().int().min(1).describe(description);
}

function optionalPositiveInteger(
  description: string,
): zod.ZodOptional<zod.ZodNumber> {
  return positiveInteger(description).optional();
}

function boundedInteger(
  description: string,
  max: number,
): zod.ZodOptional<zod.ZodNumber> {
  return zod.number().int().min(1).max(max).optional().describe(description);
}

function optionalTimeout(description: string): zod.ZodDefault<zod.ZodNumber> {
  return zod
    .number()
    .int()
    .min(1)
    .max(MAX_WAIT_TIMEOUT)
    .default(DEFAULT_WAIT_TIMEOUT)
    .describe(description);
}

function filePath(description: string): zod.ZodOptional<zod.ZodString> {
  return optionalString(description);
}

function withoutUndefined<T extends object>(options: T): T {
  const result = {...options};
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined) {
      Reflect.deleteProperty(result, key);
    }
  }
  return result;
}

function toFormatterLocation(
  location: SetBreakpointOptions | BreakpointRecord['requested'],
): DebuggerLocation {
  const result: DebuggerLocation = {lineNumber: location.lineNumber};
  if (location.url !== undefined) {
    result.url = location.url;
  }
  if (location.scriptId !== undefined) {
    result.scriptId = location.scriptId;
  }
  if (location.columnNumber !== undefined) {
    result.columnNumber = location.columnNumber;
  }
  return result;
}

function toBreakpointFormatterRecord(record: BreakpointRecord): {
  breakpointId: string;
  requested: DebuggerLocation;
  resolved: readonly DebuggerLocation[];
  condition?: string;
  bound: boolean;
} {
  const result: {
    breakpointId: string;
    requested: DebuggerLocation;
    resolved: readonly DebuggerLocation[];
    condition?: string;
    bound: boolean;
  } = {
    breakpointId: record.breakpointId,
    requested: toFormatterLocation(record.requested),
    resolved: record.resolved.map(toFormatterLocation),
    bound: record.bound,
  };
  if (record.condition !== undefined) {
    result.condition = record.condition;
  }
  return result;
}

function toPausedFormatterState(state: PausedStateView | PausedSnapshot): {
  reason: string;
  hitBreakpoints: readonly string[];
  callFrames: readonly PausedCallFrame[];
} {
  return {
    reason: state.reason ?? '',
    hitBreakpoints: state.hitBreakpoints,
    callFrames: state.callFrames.map(frame => {
      const result: PausedCallFrame = {
        functionName: frame.functionName,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      };
      if (frame.url !== undefined) {
        result.url = frame.url;
      }
      if (frame.scriptId !== undefined) {
        result.scriptId = frame.scriptId;
      }
      return result;
    }),
  };
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

function toProtocolRemoteObject(
  object: RemoteObjectLike,
): DevTools.Protocol.Runtime.RemoteObject {
  const result: DevTools.Protocol.Runtime.RemoteObject = {
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

function toEvaluationFormatterResult(
  result: EvaluationResultLike,
): EvaluationResult {
  const formatted: EvaluationResult = {
    result: toProtocolRemoteObject(result.result),
  };
  if (result.exceptionDetails !== undefined) {
    formatted.exceptionDetails = {
      exceptionId: 0,
      text: result.exceptionDetails.text,
      lineNumber: 0,
      columnNumber: 0,
    };
  }
  return formatted;
}

function formatObjectProperties(view: ObjectPropertiesView): string {
  const lines = [`${view.objectId} (generation ${view.generation}):`];
  for (const property of view.properties) {
    lines.push(`  ${formatObjectProperty(property)}`);
  }
  if (view.truncated) {
    lines.push('  more properties omitted');
  }
  return lines.join('\n');
}

function formatObjectProperty(property: ObjectPropertyView): string {
  const value = property.value
    ? toProtocolRemoteObject(property.value)
    : undefined;
  const text = value ? formatRemoteObjectForTool(value) : '(unavailable)';
  return `${property.name} = ${text}`;
}

function formatRemoteObjectForTool(
  object: DevTools.Protocol.Runtime.RemoteObject,
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

function toSearchFormatterMatches(
  matches: readonly ScriptSearchMatch[],
): readonly SearchMatchRecord[] {
  const result: SearchMatchRecord[] = [];
  for (const match of matches) {
    const record: SearchMatchRecord = {
      scriptId: match.scriptId,
      lineNumber: match.lineNumber,
      lineContent: match.lineContent,
      sourceLines: match.contextLines.map(line => line.text),
    };
    if (match.url !== undefined) {
      record.url = match.url;
    }
    result.push(record);
  }
  return result;
}

function formatScriptList(list: ScriptListResult): string {
  const lines = [`${list.scripts.length} script(s) (total ${list.total}):`];
  for (const script of list.scripts) {
    lines.push(
      `- ${script.scriptId} ${script.url} (${script.length} bytes, lines ${script.startLine}-${script.endLine})`,
    );
  }
  if (list.truncated) {
    lines.push('more script(s) omitted');
  }
  return lines.join('\n');
}

function formatScriptSource(source: ScriptSourceResult): string {
  const lines = [
    `Script ${source.scriptId} ${source.url} lines ${source.startLine}-${source.endLine} of ${source.totalLines} (${source.byteLength} bytes):`,
  ];
  for (const line of source.lines) {
    lines.push(`  ${line.lineNumber}: ${line.text}`);
  }
  if (source.previewTruncated) {
    lines.push('more preview line(s) omitted');
  }
  if (source.filePath !== undefined) {
    lines.push(`Exported to ${source.filePath}.`);
  }
  return lines.join('\n');
}

function formatInlineSearch(
  result: ScriptSearchResult & {matches: readonly ScriptSearchMatch[]},
): string {
  const formatter = new SearchMatchFormatter(
    {
      query: result.query,
      matches: toSearchFormatterMatches(result.matches),
    },
    {maxMatches: result.matches.length || 1},
  );
  return formatter.toString();
}

function formatExportedSearch(result: ScriptSearchResult): string {
  const lines = [
    `${result.matchCount} match(es) for "${result.query}" in ${result.scannedScripts} script(s):`,
  ];
  if (result.truncated) {
    lines.push('more match(es) omitted');
  }
  if ('filePath' in result && result.filePath !== undefined) {
    lines.push(`Exported to ${result.filePath}.`);
  }
  return lines.join('\n');
}

function formatPauseResult(result: PauseResult | PendingPauseResult): string {
  if (result.status === 'pending') {
    return `Pause pending for generation ${result.generation}; call debugger_wait_for_paused.`;
  }
  return new PausedStateFormatter(
    toPausedFormatterState(result.snapshot),
  ).toString();
}

export const setBreakpoint: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_set_breakpoint',
  description:
    'Set a pausing breakpoint at a 1-based URL or script location, optionally evaluating a JavaScript condition, and report its resolved locations.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
    conditions: ['javascriptEvaluation'],
  },
  schema: {
    url: optionalString(
      'Script URL for the breakpoint. Provide exactly one of url or scriptId.',
    ),
    scriptId: optionalString(
      'CDP script ID for the breakpoint. Provide exactly one of url or scriptId.',
    ),
    lineNumber: positiveInteger('1-based line number for the breakpoint.'),
    columnNumber: optionalPositiveInteger(
      'Optional 1-based column number for the breakpoint.',
    ),
    condition: optionalString(
      'Optional JavaScript expression evaluated when the breakpoint is reached.',
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const {url, scriptId, lineNumber, columnNumber, condition} = request.params;
    if ((url === undefined) === (scriptId === undefined)) {
      throw new Error(
        'Provide exactly one of url or scriptId for debugger_set_breakpoint.',
      );
    }
    const options = withoutUndefined({
      url,
      scriptId,
      lineNumber,
      columnNumber,
      condition,
    });
    const record = await request.page.setBreakpoint(options);
    response.appendResponseLine(
      new BreakpointFormatter([toBreakpointFormatterRecord(record)]).toString(),
    );
  },
}));

export const listBreakpoints: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_list_breakpoints',
  description:
    'List only the breakpoints owned by this debugger module, with their requested and resolved 1-based locations.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {},
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const records = request.page.listBreakpoints();
    response.appendResponseLine(
      new BreakpointFormatter(
        records.map(toBreakpointFormatterRecord),
      ).toString(),
    );
  },
}));

export const removeBreakpoint: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_remove_breakpoint',
  description:
    'Remove one breakpoint owned by this debugger module by its breakpointId.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    breakpointId: zod
      .string()
      .min(1)
      .describe('The breakpointId returned by debugger_set_breakpoint.'),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const {breakpointId} = request.params;
    const removed = await request.page.removeBreakpoint(breakpointId);
    response.appendResponseLine(
      removed
        ? `Removed breakpoint ${breakpointId}.`
        : `Breakpoint ${breakpointId} was not found.`,
    );
  },
}));

export const pause: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_pause',
  description:
    'Pause JavaScript execution and wait up to the timeout for the next pause; a pending result can be awaited with debugger_wait_for_paused.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    timeout: optionalTimeout(
      `Maximum wait in milliseconds; defaults to ${DEFAULT_WAIT_TIMEOUT} and is capped at ${MAX_WAIT_TIMEOUT}.`,
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const options = withoutUndefined({timeout: request.params.timeout});
    const result = await request.page.pause(options);
    response.appendResponseLine(formatPauseResult(result));
  },
}));

export const resume: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_resume',
  description:
    'Resume JavaScript execution and invalidate the current paused snapshot and its identifiers.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {},
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    await request.page.resume();
    response.appendResponseLine('Execution resumed.');
  },
}));

export const step: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_step',
  description:
    'Step into, over, or out of the current paused JavaScript frame and wait for the next pause.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    direction: zod
      .enum(['into', 'over', 'out'])
      .describe('Direction to step from the current paused frame.'),
    timeout: optionalTimeout(
      `Maximum wait in milliseconds; defaults to ${DEFAULT_WAIT_TIMEOUT} and is capped at ${MAX_WAIT_TIMEOUT}.`,
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const {direction, timeout} = request.params;
    const result = await request.page.step(
      direction,
      withoutUndefined({timeout}),
    );
    response.appendResponseLine(formatPauseResult(result));
  },
}));

export const disable: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_disable',
  description:
    'Disable the Debug Session, resume a paused page, remove this module’s breakpoints, and restore the page’s original non-pausing behavior while leaving logpoints intact.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {},
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    request.page.disable();
    response.appendResponseLine('Debug Session disabled.');
  },
}));

export const waitForPaused: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_wait_for_paused',
  description:
    'Wait without holding the page queue for the next JavaScript pause and report its reason, hit breakpoints, and call frames.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    timeout: zod
      .number()
      .int()
      .min(1)
      .max(MAX_WAIT_TIMEOUT)
      .default(DEFAULT_WAIT_TIMEOUT)
      .describe(
        `Maximum wait in milliseconds; defaults to ${DEFAULT_WAIT_TIMEOUT} and is capped at ${MAX_WAIT_TIMEOUT}.`,
      ),
  },
  blockedByDialog: false,
  concurrency: 'none',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const snapshot = await request.page.waitForPaused({
      timeout: request.params.timeout,
    });
    response.appendResponseLine(
      new PausedStateFormatter(toPausedFormatterState(snapshot)).toString(),
    );
  },
}));

export const getPausedState: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_get_paused_state',
  description:
    'Read the current paused state, including reason, hit breakpoints, call frames, and optionally scope summaries.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    includeScopes: optionalBoolean(
      'Include scope identifiers and properties in the paused snapshot.',
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const state = request.page.getPausedState(
      withoutUndefined({includeScopes: request.params.includeScopes}),
    );
    response.appendResponseLine(
      state.paused
        ? new PausedStateFormatter(toPausedFormatterState(state)).toString()
        : 'The page is not paused.',
    );
  },
}));

export const evaluate: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'debugger_evaluate',
  description:
    'Evaluate a JavaScript expression on a paused call frame and format its result or exception.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
    conditions: ['javascriptEvaluation'],
  },
  schema: {
    callFrameId: zod
      .string()
      .min(1)
      .describe('The callFrameId from the current paused state.'),
    expression: zod
      .string()
      .min(1)
      .describe('JavaScript expression to evaluate on the call frame.'),
    returnByValue: optionalBoolean('Return the result by value.'),
    generatePreview: optionalBoolean('Generate a preview for object results.'),
    throwOnSideEffect: optionalBoolean(
      'Throw if evaluation would produce a side effect.',
    ),
    timeout: optionalPositiveInteger(
      'Optional evaluation timeout in milliseconds.',
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const {
      callFrameId,
      expression,
      returnByValue,
      generatePreview,
      throwOnSideEffect,
      timeout,
    } = request.params;
    const options = withoutUndefined({
      callFrameId,
      expression,
      returnByValue,
      generatePreview,
      throwOnSideEffect,
      timeout,
    });
    const result = await request.page.evaluateOnCallFrame(options);
    response.appendResponseLine(
      new EvaluationResultFormatter(
        toEvaluationFormatterResult(result),
      ).toString(),
    );
  },
}));

export const getObjectProperties: DebuggerToolFactory = defineDebuggerTool(
  () => ({
    name: 'debugger_get_object_properties',
    description:
      'Read a bounded set of properties from an object ID belonging to the current paused snapshot.',
    annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
    schema: {
      objectId: zod
        .string()
        .min(1)
        .describe('The objectId from the current paused scope.'),
      ownProperties: optionalBoolean(
        'Whether to request only own properties from CDP.',
      ),
      generatePreview: optionalBoolean(
        'Whether CDP should generate previews for returned properties.',
      ),
      maxProperties: boundedInteger(
        `Maximum properties to return; capped at ${MAX_BOUND}.`,
        MAX_BOUND,
      ),
      depth: zod
        .number()
        .int()
        .min(0)
        .max(1)
        .optional()
        .describe('Property depth, either 0 or 1.'),
    },
    blockedByDialog: false,
    concurrency: 'page',
    verifyFilesSchema: {},
    handler: async (request, response) => {
      const {objectId, ownProperties, generatePreview, maxProperties, depth} =
        request.params;
      const options = withoutUndefined({
        objectId,
        ownProperties,
        generatePreview,
        maxProperties,
        depth,
      });
      const view = await request.page.getObjectProperties(options);
      response.appendResponseLine(formatObjectProperties(view));
    },
  }),
);

export const listScripts: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'list_scripts',
  description:
    'List bounded metadata for parsed scripts, optionally filtered by URL, without enabling pausing mode.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    urlFilter: optionalString(
      'Case-insensitive URL substring or URL path suffix filter.',
    ),
    maxScripts: boundedInteger(
      `Maximum scripts to return; capped at ${MAX_BOUND}.`,
      MAX_BOUND,
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const {urlFilter, maxScripts} = request.params;
    const options = withoutUndefined({urlFilter, maxScripts});
    const list = request.page.listScripts(options);
    response.appendResponseLine(formatScriptList(list));
  },
}));

export const getScriptSource: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'get_script_source',
  description:
    'Read a bounded preview of parsed script source using 1-based line numbers, optionally exporting the selected lines to a filesystem path.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    scriptId: zod.string().min(1).describe('CDP script ID.'),
    startLine: optionalPositiveInteger(
      'First 1-based source line; defaults to 1.',
    ),
    endLine: optionalPositiveInteger(
      'Last 1-based source line; defaults to the end of the script.',
    ),
    filePath: filePath(
      'Absolute or working-directory-relative path for exporting the selected source.',
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {filePath: true},
  handler: async (request, response) => {
    const {scriptId, startLine, endLine, filePath} = request.params;
    const options = withoutUndefined({
      scriptId,
      startLine,
      endLine,
      filePath,
    });
    const source = await request.page.getScriptSource(options);
    response.appendResponseLine(formatScriptSource(source));
  },
}));

export const searchInScripts: DebuggerToolFactory = defineDebuggerTool(() => ({
  name: 'search_in_scripts',
  description:
    'Search parsed script sources with bounded matches and locally derived 1-based columns, optionally exporting full matches to a filesystem path.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    query: zod.string().min(1).describe('Literal text or regular expression.'),
    caseSensitive: optionalBoolean('Make the search case-sensitive.'),
    isRegex: optionalBoolean('Interpret query as a regular expression.'),
    urlFilter: optionalString(
      'Case-insensitive URL substring or URL path suffix filter.',
    ),
    contextLines: zod
      .number()
      .int()
      .min(0)
      .max(MAX_CONTEXT_LINES)
      .optional()
      .describe(
        `Number of surrounding source lines to include; capped at ${MAX_CONTEXT_LINES}.`,
      ),
    maxMatches: boundedInteger(
      `Maximum matches to return; capped at ${MAX_BOUND}.`,
      MAX_BOUND,
    ),
    maxScripts: boundedInteger(
      `Maximum scripts to scan; capped at ${MAX_BOUND}.`,
      MAX_BOUND,
    ),
    excludeMinified: optionalBoolean('Skip scripts that appear minified.'),
    filePath: filePath(
      'Absolute or working-directory-relative path for exporting full JSON matches.',
    ),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {filePath: true},
  handler: async (request, response) => {
    const {
      query,
      caseSensitive,
      isRegex,
      urlFilter,
      contextLines,
      maxMatches,
      maxScripts,
      excludeMinified,
      filePath,
    } = request.params;
    const options = withoutUndefined({
      query,
      caseSensitive,
      isRegex,
      urlFilter,
      contextLines,
      maxMatches,
      maxScripts,
      excludeMinified,
      filePath,
    });
    const result = await request.page.searchInScripts(options);
    response.appendResponseLine(
      'matches' in result
        ? formatInlineSearch(result)
        : formatExportedSearch(result),
    );
  },
}));
