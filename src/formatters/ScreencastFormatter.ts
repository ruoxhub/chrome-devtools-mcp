/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type ScreencastStopReason =
  'user_stopped' | 'duration_limit' | 'page_disposed' | 'connection_lost';

export interface StructuredScreencast {
  filePath: string;
  /**
   * Wall-clock time between the recording starting and the stop being
   * requested. The muxer does not report the exact video duration.
   */
  durationMs: number;
  bytes: number;
  stopReason: ScreencastStopReason;
  completeness: 'complete' | 'partial';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function stopReasonText(reason: ScreencastStopReason): string {
  switch (reason) {
    case 'user_stopped':
      return 'stopped by the caller';
    case 'duration_limit':
      return 'stopped automatically at maxDurationMs';
    case 'page_disposed':
      return 'stopped because the page was closed or disconnected';
    case 'connection_lost':
      return 'stopped because the browser connection was lost';
  }
}

function formatScreencast(screencast: StructuredScreencast): string {
  const lines = [
    `Screencast saved to ${screencast.filePath}.`,
    `The recording is ${screencast.completeness} (${formatBytes(screencast.bytes)} over ${(screencast.durationMs / 1000).toFixed(1)}s, ${stopReasonText(screencast.stopReason)}).`,
  ];
  if (screencast.completeness === 'partial') {
    lines.push(
      'The file is empty: no frames were written, so nothing can be played.',
    );
  }
  return lines.join('\n');
}

export class ScreencastFormatter {
  readonly #screencast: StructuredScreencast;

  constructor(screencast: StructuredScreencast) {
    this.#screencast = {...screencast};
  }

  toJSON(): StructuredScreencast {
    return {...this.#screencast};
  }

  toString(): string {
    return formatScreencast(this.toJSON());
  }
}
