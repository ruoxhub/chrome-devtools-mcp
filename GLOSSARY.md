# chrome-devtools-mcp

A local MCP server and CLI that exposes Chrome and DevTools operations to an AI
client. The vocabulary below is what this server's own tools and code mean by
these words; DevTools and the browser have their own glossaries.

## Language

**Page**:
A browser target this server drives, identified by a number the client passes as
`pageId`. One page is selected at a time.
_Avoid_: Tab, target, window

**Injection**:
Running caller-provided JavaScript inside a page, either once in the current
document or again in every document loaded afterwards.
_Avoid_: Evaluate, execute

**Hook**:
A script injected into a page that reports, and optionally stops, one kind of
page operation to the console. A hook belongs to one page and is registered
until it is removed or the page is closed.
_Avoid_: Interceptor, breakpoint, probe, monkeypatch

**Persistent hook**:
A hook that is injected again into every document a page loads, so it survives
navigation and reload.
_Avoid_: Global hook, permanent hook

**Hook event**:
One line a hook script writes to the console when the hooked operation runs.
Comes back through the same console collector as the page's own messages, not
through a channel of its own.
_Avoid_: Hook record, callback, notification

**Logpoint**:
An expression a page logs every time a given source line executes, set at a
script location and resolved through source maps.
_Avoid_: Breakpoint, console breakpoint
