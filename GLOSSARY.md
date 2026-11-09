# Chrome DevTools MCP

Chrome DevTools MCP exposes browser automation and debugging capabilities to AI agents through MCP tools and a CLI.

## Language

**Debug Session**:
The period during which pausing is enabled for one page, ending when debugging is explicitly disabled or the page is closed.
_Avoid_: Saved session, session file

**Breakpoint**:
A script location where JavaScript execution pauses when reached. Unlike a logpoint, it does not merely record a value and continue.
_Avoid_: Pause point, tracepoint

**Logpoint**:
A non-pausing breakpoint that evaluates an expression and reports the result to the console.
_Avoid_: Conditional breakpoint, logging breakpoint

**Paused State**:
The condition of a page whose JavaScript execution has stopped, making its current call frames and scopes available for inspection.
_Avoid_: Debugger state, stopped state

**Paused Snapshot**:
An MCP-visible representation of the current Paused State, valid only until execution resumes or the page's execution state changes.
_Avoid_: Paused event, saved pause

**Script**:
JavaScript source parsed in a page, identified by a script ID and usually associated with a URL.
_Avoid_: Source file, module
