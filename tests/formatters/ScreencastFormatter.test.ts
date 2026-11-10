/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  ScreencastFormatter,
  type StructuredScreencast,
} from '../../src/formatters/ScreencastFormatter.js';

function createScreencast(
  overrides: Partial<StructuredScreencast> = {},
): StructuredScreencast {
  return {
    filePath: '/tmp/screencast.mp4',
    durationMs: 12_300,
    bytes: 4_194_304,
    stopReason: 'user_stopped',
    completeness: 'complete',
    ...overrides,
  };
}

describe('ScreencastFormatter', () => {
  it('describes a complete recording and its size', () => {
    const text = new ScreencastFormatter(createScreencast()).toString();
    assert.ok(text.includes('Screencast saved to /tmp/screencast.mp4.'));
    assert.ok(
      text.includes(
        'The recording is complete (4.0 MiB over 12.3s, stopped by the caller).',
      ),
    );
    assert.ok(!text.includes('partial recording can be unplayable'));
  });

  it('explains that an empty recording cannot be played', () => {
    const text = new ScreencastFormatter(
      createScreencast({
        bytes: 0,
        stopReason: 'page_disposed',
        completeness: 'partial',
      }),
    ).toString();
    assert.ok(text.includes('is partial (0 B over 12.3s'));
    assert.ok(text.includes('stopped because the page was closed'));
    assert.ok(text.includes('The file is empty'));
  });

  it('reports the duration limit as the stop reason', () => {
    const text = new ScreencastFormatter(
      createScreencast({stopReason: 'duration_limit'}),
    ).toString();
    assert.ok(text.includes('stopped automatically at maxDurationMs'));
  });

  it('exposes the structured value through toJSON()', () => {
    const screencast = createScreencast();
    assert.deepStrictEqual(
      new ScreencastFormatter(screencast).toJSON(),
      screencast,
    );
  });
});
