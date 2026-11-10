# T1 formatter interfaces (context pointer for T4)

Source: `src/formatters/DebuggerFormatter.ts` (merged via `7370fd90`).
All coordinates are tool-side 1-based; formatters do not convert.
Every class has `toJSON()` with an explicitly named exported result type and
`toString()` built from it.

1. `BreakpointFormatter(records: readonly BreakpointRecord[], options?: BreakpointFormatterOptions)`
   → `BreakpointFormatterResult`
   - `BreakpointFormatterOptions {maxBreakpoints?}`
   - `BreakpointRecord {breakpointId, requested: DebuggerLocation, resolved: readonly DebuggerLocation[], condition?, bound}`
   - `DebuggerLocation {url?, scriptId?, lineNumber, columnNumber?}`
2. `PausedStateFormatter(state: PausedState, options?: PausedStateFormatterOptions)`
   → `PausedStateFormatterResult`
   - `PausedStateFormatterOptions {maxCallFrames?, maxHitBreakpoints?}`
   - `PausedState {reason, hitBreakpoints: readonly string[], callFrames: readonly PausedCallFrame[]}`
   - `PausedCallFrame {functionName, url?, scriptId?, lineNumber, columnNumber}`
3. `ScopeSummaryFormatter(summary: ScopeSummary, options?: ScopeSummaryFormatterOptions)`
   → `ScopeSummaryFormatterResult`
   - `ScopeSummaryFormatterOptions {maxDepth?, maxScopes?, maxPropertiesPerScope?, maxProperties?}`
   - `ScopeSummary {scopes: readonly ScopeRecord[], properties: readonly ScopeProperty[]}`
   - `ScopeRecord {type, name?, object?: Protocol.Runtime.RemoteObject, properties: readonly ScopeProperty[]}`
   - `ScopeProperty {name, value?: Protocol.Runtime.RemoteObject, children?: readonly ScopeProperty[]}`
   - Uses `formatRemoteObject`.
4. `EvaluationResultFormatter(result: EvaluationResult)`
   → `EvaluationResultFormatterResult`
   - `EvaluationResult {result?: Protocol.Runtime.RemoteObject, exceptionDetails?: Protocol.Runtime.ExceptionDetails}`
5. `SearchMatchFormatter(data: SearchMatches, options?: SearchMatchFormatterOptions)`
   → `SearchMatchFormatterResult`
   - `SearchMatchFormatterOptions {contextLines?, maxMatches?, maxLineLength?}`
   - `SearchMatches {query, isRegex?, caseSensitive?, matches: readonly SearchMatchRecord[]}`
   - `SearchMatchRecord {scriptId, url?, lineNumber, lineContent, sourceLines?: readonly string[]}`
   - Column offset derived locally; invalid regex / no match → `undefined`;
     `truncateText` grapheme-safe truncation before regex execution and for output.
