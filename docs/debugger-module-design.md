# Debugger module design details

This document records the agreed debugger-module design and the CDP/Puppeteer
facts that constrain its schemas. It supplements `GLOSSARY.md` and the ADRs in
`docs/adr/`; it is not an implementation spec for a published API.

## Sources

- Puppeteer: [CdpSession.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/CdpSession.ts),
  [Connection.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/Connection.ts),
  [CDPSession API](https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.cdpsession.md).
- Chrome DevTools Protocol: [Debugger domain](https://chromedevtools.github.io/devtools-protocol/tot/Debugger),
  [Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime),
  [protocol types](https://github.com/chromedevtools/devtools-protocol).
- Local protocol definitions: `third_party/devtools-frontend/front_end/generated/protocol.ts`.

## Agreed scope

Fourteen tools in the existing `DEBUGGING` category: three breakpoint tools,
four execution-control tools, four pause-inspection tools, and three script
tools. Logpoints, watch expressions, XHR/event breakpoints, blackboxing,
function trees, and saved sessions remain out of scope. See
`docs/adr/0001-share-devtools-debugger-session.md` and
`docs/adr/0002-paused-snapshots-and-tool-concurrency.md`.

## Puppeteer CDP session facts

`page.createCDPSession()` calls `Target.attachToTarget` with `flatten: true` and
returns a session with its own unique `sessionId`. `session.send(method,
params)` issues commands and `session.on(event, listener)` subscribes to events;
`session.detach()` stops all events and makes further sends fail with a
`TargetCloseError`. Multiple sessions can attach to one target, but each
receives its own copy of events. This is why the module reuses the page's
existing `DebuggerModel` session instead of creating a second one: a second
session would independently receive `Debugger.paused` and could race the
existing model's automatic resume.

## Tool-to-protocol mapping

| Tool | CDP / DevTools API | Notes |
| --- | --- | --- |
| `debugger_set_breakpoint` | `Debugger.setBreakpointByUrl` or `Debugger.setBreakpoint`; or the universe breakpoint manager | `lineNumber` required, `url`/`urlRegex`/`scriptHash` or `location`, optional `columnNumber` and `condition`; returns `breakpointId` and resolved `locations`/`actualLocation`. |
| `debugger_list_breakpoints` | Local breakpoint records; `Debugger.breakpointResolved` updates them | Reports requested and resolved positions. Logpoints are separate. |
| `debugger_remove_breakpoint` | `Debugger.removeBreakpoint` | Takes `breakpointId`. |
| `debugger_pause` | `Debugger.pause`, then `Debugger.paused` | `pause` stops on the next JavaScript statement, not immediately; therefore a bounded wait is required. |
| `debugger_resume` | `Debugger.resume` | Optional `terminateOnResume`; invalidates the pause generation. |
| `debugger_step` | `Debugger.stepInto` / `stepOver` / `stepOut` | No parameters; wait for the next pause, never return the previous snapshot. |
| `debugger_disable` | `Debugger.setSkipAllPauses({skip:true})`, `Debugger.removeBreakpoint`, `Debugger.resume` | Restores the page's original non-pausing behavior and leaves logpoints intact. |
| `debugger_wait_for_paused` | `Debugger.paused` event | `concurrency: 'none'`, default 10 s, maximum 30 s. |
| `debugger_get_paused_state` | Cached `PausedEvent` / `DebuggerModel.debuggerPausedDetails()` | `reason`, `hitBreakpoints`, `callFrames`; scopes are opt-in. |
| `debugger_evaluate` | `Debugger.evaluateOnCallFrame` | `callFrameId`, `expression`, `objectGroup`, `returnByValue`, `generatePreview`, `throwOnSideEffect`, `timeout`, `scopeNumber`; returns `result` and `exceptionDetails`. |
| `debugger_get_object_properties` | `Runtime.getProperties` | `objectId`, `ownProperties`, `generatePreview`; bounded depth and count. |
| `list_scripts` | `DebuggerModel.scripts()` / `Debugger.scriptParsed` | `scriptId`, `url`, `hash`, `sourceMapURL`, `hasSourceURL`, `isModule`, `length`, `startLine`/`startColumn`/`endLine`/`endColumn`, `embedderName`, `resolvedBreakpoints`. |
| `get_script_source` | `Debugger.getScriptSource` / `Script.requestContentData()` | Returns `scriptSource`; line ranges and optional file export are applied locally. |
| `search_in_scripts` | `Debugger.searchInContent` / `Script.searchInContent()` | `scriptId`, `query`, `caseSensitive`, `isRegex`; CDP returns `SearchMatch[]`. |

## Coordinate convention

CDP `Debugger.Location.lineNumber` and `columnNumber` are **0-based**
(`protocol.ts`, `Debugger.Location`). The tool API is **1-based**, matching
`set_logpoints`: the controller subtracts one from incoming line/column values
and adds one when reporting locations. `LogpointManager` already uses this
convention.

## Search-match correction

CDP's `Debugger.SearchMatch` contains only `lineNumber` and `lineContent`
(`protocol.ts`, `Debugger.SearchMatch`). It does **not** contain a
`columnNumber`. Column offsets and surrounding context therefore come from a
local second pass over `lineContent`, using DevTools'
`TextUtils.performSearchInSearchMatches` as `Script.searchInContent()` already
does (`front_end/core/sdk/Script.ts`). The tool reports line number, line
content, a bounded context window, and a locally derived column offset; it does
not claim CDP supplies the column.

## Pause lifetime

`Debugger.CallFrame.callFrameId` is documented as valid only while the virtual
machine is paused. `Runtime.RemoteObject.objectId` values obtained from a
paused scope are likewise tied to that pause. This is the protocol-level reason
for the pause-generation contract: resume, step, navigation, and disable must
invalidate stored snapshots and their identifiers.

`Debugger.scriptParsed` is emitted for all known, uncollected scripts when the
Debugger domain is enabled, and carries `resolvedBreakpoints` on later parses.
This supports reporting source-map re-resolution after reload without a
separate script cache.

## Files and verification

Implementation files: `src/DebuggerController.ts`, `src/ScriptManager.ts`,
`src/tools/debugger.ts`, `src/formatters/DebuggerFormatter.ts`, plus lifecycle
integration in `src/McpPage.ts` and build/test registrations. Tests use
`createHandlerMocks()` for tools and mocked dependencies for core classes, with
a small real-Chrome suite for pause/resume and search behavior. Final gates:
`npm run gen`, `npm run format`, `npm run test`.
