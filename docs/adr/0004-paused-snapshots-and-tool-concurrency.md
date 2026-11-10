# Expose paused snapshots instead of debugger notifications

Debugger tools will expose the current Paused State through bounded tool calls and page-scoped snapshots rather than MCP notifications. Call-frame and object identifiers belong to a pause generation and become invalid after execution resumes, execution state changes, or the page navigates. Long waits run outside the page task queue so they cannot block the resume call that would complete them.

While a page is paused, unrelated page tools will fail promptly with guidance to resume instead of waiting for the browser protocol timeout. Debugger inspection and execution-control tools remain available.

## Considered Options

MCP notifications were rejected because the project does not otherwise provide a debugger event stream, and clients would still need a way to retrieve the current state after reconnecting or starting a conversation mid-pause. Blocking page tools until Chrome resumes was rejected because it hides the actionable paused state and can hold the task queue until the protocol timeout.

## Consequences

Clients must tolerate stale pause identifiers and use the wait tool to observe later pauses. The page owns pause generation and listener cleanup, and disabling debugging or disposing the page must resolve or reject every outstanding wait.
