# Page hooks: five types, current-document injection, console output

`create_hook` and `remove_hook` inject a script into the selected page that
reports or blocks one page operation. The port of the upstream `hook` module
keeps five of its eight hook types and drops the streaming and bookkeeping
machinery around them: function and object-member hooks, an eval hook, a storage
hook and a cookie hook. Hooks apply to the current document unless `persist` is
set, and they report through `console.log` rather than a dedicated event channel.

## Considered Options

The `fetch`, `xhr` and `websocket` hooks were dropped even though they were the
largest generators upstream. `list_network_requests` and `get_network_request`
read the same traffic through the CDP Network domain, which reports headers,
body, status and timing without patching the page and without the page being
able to observe the instrumentation. Keeping both would give the agent two
answers that can disagree, so the weaker one is gone.

The upstream `HookManager` tracked per-hook records, statistics, export and
eviction limits, but nothing ever recorded a record: the generated scripts only
wrote to the console. That state, and three re-export files that only forwarded
the generators, were not ported. What remains is a per-page registry of
registered hooks with the CDP script identifiers needed to unregister them.

Injection defaults to the current document because a hook that silently patches
a page the caller is not looking at is worse than a hook the caller asked for.
`persist` exists because the useful case for persistent injection — watching a
flow across a login redirect — cannot be reached with a current-document
injection at all.

The upstream module returned script text plus a note telling the caller to inject
it with tools from the upstream repository. Here the tool owns injection, which
means it can report whether the target existed, and it can unregister a
persistent script on removal.

## Consequences

Removing a hook cannot undo the patch of the current document: a monkeypatched
function stays wrapped until the page navigates or reloads. `remove_hook`
therefore stops future injection and forgets the hook; it does not restore the
page, and the tool description says so.

A hook that fails to patch the current document is not registered unless it is
persistent, where the target may only appear in a later document. The failure is
reported in the tool response rather than as an exception, except for the
non-persistent case, which throws instead of claiming a hook that does nothing.

Hook events share the console with the page's own messages. They are told apart
by a `[Hook]` prefix, and a page that clears its console or floods it loses hook
events with everything else.
