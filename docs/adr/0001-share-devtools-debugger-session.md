# Share the page's DevTools debugger session

The debugger tools will reuse the page's existing DevTools `DebuggerModel` and CDP session instead of opening an independent debugging session. The existing session enables the Debugger domain with `skipAllPauses` set to true, and its model automatically resumes when it receives a pause in that mode; a second session would therefore race it for pause and resume ownership. Debugging will coordinate that setting, share breakpoint ownership with logpoints, and keep `DebuggerModel` as the single owner of pause and resume handling.

## Considered Options

An independent CDP session was rejected because every enabled session can receive the same pause and either session can resume it. Coordinating two breakpoint stores and two pause owners would add complexity without providing a capability absent from the existing model.

## Consequences

Entering a Debug Session changes pause behavior for the page and must restore the previous non-pausing behavior when debugging is disabled or the page is disposed. Logpoints and pausing breakpoints must remain distinguishable even though they share the DevTools breakpoint manager.

A real-Chrome test confirmed that DevTools keeps one breakpoint per normalized location: setting a logpoint and a pausing breakpoint on the same script line fails with `Debugger.setBreakpointByUrl: Breakpoint at specified location already exists`. Clients must place them on different lines; the two kinds of breakpoint can otherwise coexist in the same Debug Session.
