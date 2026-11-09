# Record screencasts with the Chrome recorder only, with a duration limit

`Page.startScreenRecording` (through `page.record()`) is the only screencast
implementation. The legacy ffmpeg path (`Page.startScreencast` + a spawned
ffmpeg process, `--experimentalScreencast` and `--experimentalFfmpegPath`) is
removed, so every screencast is a Chrome-encoded mp4. A recording stops
automatically after `maxDurationMs`, which defaults to ten minutes.

## Considered Options

Keeping the ffmpeg path would have preserved WebM output and recording on Chrome
versions without `Page.startScreenRecording`. Both are niche: WebM can be
transcoded by the caller, and the Chrome recorder has been the default since
`--experimentalScreencast` was marked deprecated. The legacy path also carried
most of the code: extension detection, a second recorder branch, an ffmpeg
missing error, and tests for all of it, none of which the default path needs.

An unlimited recording was rejected as the default because a forgotten
`screencast_stop` grows the output file until the process ends. A size limit was
rejected because it cannot be enforced: the Chrome recorder reads no frames
until `stop()`, so the file stays at zero bytes for the whole recording and both
its size and its frame count are only known afterwards.

## Consequences

A caller that asks for a `.webm` path gets the same path with its extension
replaced by `.mp4`, so the requested name no longer describes the content.
Anyone who relied on `--experimentalScreencast` for a Chrome build without
`Page.startScreenRecording` has no recording at all; the failing call reports
that the connected Chrome is too old.

`durationMs` in the stop result is measured on the server between start and stop,
not read from the mp4, because the recorder does not report a duration.

Because bytes are written only while stopping, a server process that dies
mid-recording leaves no usable file, and a write error during the stop (a full
disk, for example) surfaces inside the Puppeteer write stream, which this server
does not own and does not observe. The start preflight therefore rejects an
unwritable path up front, and a recording that ends with an empty file is
reported as `partial` instead of looking like a successful capture.

Measured on Chrome for Testing 156 (Windows, headless): a three-minute recording
of a 1280x720 animated page produced a 22.3 MiB AV1 file with 5385 frames and a
179.5s duration, while the file stayed at zero bytes until the stop completed.
Chrome also emits a single timestamp reset near the start of every recording
(packet timestamps jump back to zero once), in a bare `page.record()` call with
no code from this server involved, so players see it as a harmless discontinuity
rather than a defect of these tools.

The video track was AV1, not H.264: the codec is the recorder's choice, this
server does not configure it, and a player without AV1 support cannot open the
file.
