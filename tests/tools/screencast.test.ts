/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import sinon from 'sinon';

import {ConfigLocator} from '../../src/config/ConfigLocator.js';
import {ConfigParser} from '../../src/config/ConfigParser.js';
import {CdpScreenRecording} from '../../src/third_party/index.js';
import {startScreencast, stopScreencast} from '../../src/tools/screencast.js';
import {createHandlerMocks, createScreenRecorderData} from '../mocks.js';
import {createTempDir, html, withMcpContext} from '../utils.js';

function parseArgs(...argv: string[]) {
  const locator = new ConfigLocator();
  sinon.stub(locator, 'locate').returns(undefined);
  return new ConfigParser(
    'test',
    ['node', 'test', ...argv],
    {CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: 'true'},
    false,
    locator,
  ).parse();
}

function createScreencastMocks(dir: string) {
  const {page, context, response, args} = createHandlerMocks();
  const mockRecording = sinon.createStubInstance(CdpScreenRecording);
  mockRecording.stop.resolves();
  const filePath: `${string}.mp4` = `${path.join(dir, 'recording')}.mp4`;
  page.pptrPage.record.callsFake(async options => {
    if (options?.path !== undefined) {
      await fs.writeFile(options.path, 'ftyp');
    }
    return mockRecording;
  });
  page.pptrPage.evaluate.resolves({width: 800, height: 600, dpr: 2});
  page.getScreenRecorder.returns(null);
  return {page, context, response, mockRecording, args, filePath};
}

describe('screencast', () => {
  describe('screencast_start', () => {
    it('starts an mp4 recording at the page device pixel size', async () => {
      using dir = createTempDir();
      const {page, context, response, mockRecording, args, filePath} =
        createScreencastMocks(dir.path);
      context.ensureExtension.resolves(filePath);

      await startScreencast(args).handler(
        {params: {filePath, maxDurationMs: 600_000}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(
        context.ensureExtension,
        filePath,
        '.mp4',
      );
      sinon.assert.calledOnceWithExactly(page.pptrPage.record, {
        path: filePath,
        fps: undefined,
        maxWidth: 1600,
        maxHeight: 1200,
      });
      sinon.assert.calledOnce(page.setScreenRecorder);
      const started = page.setScreenRecorder.firstCall.args[0];
      assert.strictEqual(started?.recorder, mockRecording);
      assert.strictEqual(started?.filePath, filePath);
      assert.strictEqual(started?.maxDurationMs, 600_000);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        `Screencast recording started. The recording will be saved to ${filePath} and stops automatically after 600000ms. Use screencast_stop to stop it earlier.`,
      );
    });

    it('starts a recording with a temp file when no filePath is given', async () => {
      using dir = createTempDir();
      const {page, context, response, args} = createScreencastMocks(dir.path);
      const expectedPath: `${string}.mp4` = `${path.join(
        dir.path,
        'temp-screencast',
      )}.mp4`;
      context.ensureExtension.resolves(expectedPath);

      await startScreencast(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.calledOnce(context.ensureExtension);
      const generatedPath = context.ensureExtension.firstCall.args[0];
      assert.ok(generatedPath.endsWith('.mp4'));
      assert.strictEqual(context.ensureExtension.firstCall.args[1], '.mp4');
      sinon.assert.calledOnceWithExactly(page.pptrPage.record, {
        path: expectedPath,
        fps: undefined,
        maxWidth: 1600,
        maxHeight: 1200,
      });
      await fs.rm(path.dirname(generatedPath), {recursive: true, force: true});
    });

    it('errors if a recording is already active', async () => {
      using dir = createTempDir();
      const {page, context, response, mockRecording, args} =
        createScreencastMocks(dir.path);
      page.getScreenRecorder.returns(
        createScreenRecorderData({recorder: mockRecording}),
      );

      await startScreencast(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.notCalled(context.ensureExtension);
      sinon.assert.notCalled(page.pptrPage.record);
      sinon.assert.notCalled(page.setScreenRecorder);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Error: a screencast recording is already in progress. Use screencast_stop to stop it before starting a new one.',
      );
    });

    it('asks to collect a recording that already stopped', async () => {
      using dir = createTempDir();
      const {page, context, response, mockRecording, args} =
        createScreencastMocks(dir.path);
      page.getScreenRecorder.returns(
        createScreenRecorderData({
          recorder: mockRecording,
          stopping: Promise.resolve({
            filePath: '/tmp/screencast.mp4',
            durationMs: 1,
            bytes: 1,
            stopReason: 'duration_limit',
            completeness: 'complete',
          }),
        }),
      );

      await startScreencast(args).handler(
        {params: {}, page},
        response,
        context,
      );

      sinon.assert.notCalled(page.pptrPage.record);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Error: the previous screencast already stopped and is still waiting to be collected. Use screencast_stop to save it before starting a new one.',
      );
    });

    it('passes screencast fps from --screencast-fps to puppeteer', async () => {
      using dir = createTempDir();
      const {page, context, response, filePath} = createScreencastMocks(
        dir.path,
      );
      context.ensureExtension.resolves(filePath);

      await startScreencast(parseArgs('--screencast-fps=10')).handler(
        {params: {filePath}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.pptrPage.record, {
        path: filePath,
        fps: 10,
        maxWidth: 1600,
        maxHeight: 1200,
      });
    });

    it('passes screencast fps from --experimental-screencast-fps to puppeteer', async () => {
      using dir = createTempDir();
      const {page, context, response, filePath} = createScreencastMocks(
        dir.path,
      );
      context.ensureExtension.resolves(filePath);

      await startScreencast(
        parseArgs('--experimental-screencast-fps=10'),
      ).handler({params: {filePath}, page}, response, context);

      sinon.assert.calledOnceWithExactly(page.pptrPage.record, {
        path: filePath,
        fps: 10,
        maxWidth: 1600,
        maxHeight: 1200,
      });
    });

    it('lets the fps parameter override --screencast-fps', async () => {
      using dir = createTempDir();
      const {page, context, response, filePath} = createScreencastMocks(
        dir.path,
      );
      context.ensureExtension.resolves(filePath);

      await startScreencast(parseArgs('--screencast-fps=10')).handler(
        {params: {filePath, fps: 3}, page},
        response,
        context,
      );

      sinon.assert.calledOnceWithExactly(page.pptrPage.record, {
        path: filePath,
        fps: 3,
        maxWidth: 1600,
        maxHeight: 1200,
      });
    });

    it('provides a clear error when Chrome does not support recording', async () => {
      using dir = createTempDir();
      const {page, context, response, args} = createScreencastMocks(dir.path);
      context.ensureExtension.callsFake(async filePath => `${filePath}.mp4`);
      page.pptrPage.record.rejects(
        new Error(
          "Protocol error (Page.startScreenRecording): 'Page.startScreenRecording' wasn't found",
        ),
      );

      await assert.rejects(
        startScreencast(args).handler({params: {}, page}, response, context),
        /The connected Chrome does not support screen recording/,
      );

      const tempPath = page.pptrPage.record.firstCall.args[0]?.path;
      assert.ok(tempPath);
      await assert.rejects(fs.access(path.dirname(tempPath)));
      sinon.assert.notCalled(page.setScreenRecorder);
    });

    it('reports an unwritable output path before starting', async () => {
      using dir = createTempDir();
      const {page, context, response, args} = createScreencastMocks(dir.path);
      const unusable: `${string}.mp4` = `${path.join(dir.path, 'not-a-directory', 'out')}.mp4`;
      context.ensureExtension.resolves(unusable);

      await assert.rejects(
        startScreencast(args).handler(
          {params: {filePath: unusable}, page},
          response,
          context,
        ),
        /Cannot write the screencast to .*not-a-directory.*out\.mp4/,
      );

      sinon.assert.notCalled(page.pptrPage.record);
      sinon.assert.notCalled(page.setScreenRecorder);
    });

    it('stops automatically after maxDurationMs', async () => {
      using dir = createTempDir();
      const clock = sinon.useFakeTimers({
        now: 1_000,
        toFake: ['setTimeout', 'clearTimeout', 'Date'],
      });
      try {
        const {page, context, response, mockRecording, args, filePath} =
          createScreencastMocks(dir.path);
        context.ensureExtension.resolves(filePath);

        await startScreencast(args).handler(
          {params: {filePath, maxDurationMs: 1_000}, page},
          response,
          context,
        );
        sinon.assert.notCalled(mockRecording.stop);

        await clock.tickAsync(1_000);

        sinon.assert.calledOnce(mockRecording.stop);
        const data = page.setScreenRecorder.firstCall.args[0];
        assert.ok(data);
        await data.stopping;
        sinon.assert.calledOnce(mockRecording.stop);
      } finally {
        clock.restore();
      }
    });
  });

  describe('screencast_stop', () => {
    it('returns an error message if no recording is active', async () => {
      using dir = createTempDir();
      const {page, context, response, args} = createScreencastMocks(dir.path);
      await stopScreencast(args).handler({params: {}, page}, response, context);
      sinon.assert.notCalled(page.setScreenRecorder);
      sinon.assert.calledOnceWithExactly(
        response.appendResponseLine,
        'Error: no active screencast recording to stop.',
      );
    });

    it('reports the file, its size and the stop reason', async () => {
      using dir = createTempDir();
      const {page, context, response, mockRecording, args} =
        createScreencastMocks(dir.path);
      const filePath: `${string}.mp4` = `${path.join(dir.path, 'test')}.mp4`;
      await fs.writeFile(filePath, 'ftyp');
      page.getScreenRecorder.returns(
        createScreenRecorderData({
          recorder: mockRecording,
          filePath,
        }),
      );

      await stopScreencast(args).handler({params: {}, page}, response, context);

      sinon.assert.calledOnce(mockRecording.stop);
      sinon.assert.calledOnceWithExactly(page.setScreenRecorder, null);
      sinon.assert.calledOnce(response.appendResponseLine);
      const text = response.appendResponseLine.firstCall.args[0];
      assert.ok(text.includes(`Screencast saved to ${filePath}.`), text);
      assert.match(
        text,
        /is complete \(4 B over 0\.0s, stopped by the caller\)/,
      );
    });

    it('clears the recorder even if stop() throws and names the file', async () => {
      using dir = createTempDir();
      const {page, context, response, mockRecording} = createScreencastMocks(
        dir.path,
      );
      mockRecording.stop.rejects(new Error('recording error'));
      const filePath: `${string}.mp4` = `${path.join(dir.path, 'test')}.mp4`;
      page.getScreenRecorder.returns(
        createScreenRecorderData({
          recorder: mockRecording,
          filePath,
        }),
      );

      await assert.rejects(
        stopScreencast(parseArgs()).handler(
          {params: {}, page},
          response,
          context,
        ),
        /recording error/,
      );

      sinon.assert.calledOnce(mockRecording.stop);
      sinon.assert.calledOnceWithExactly(page.setScreenRecorder, null);
    });

    it('reports a recording stopped at the duration limit', async () => {
      using dir = createTempDir();
      const clock = sinon.useFakeTimers({
        now: 5_000,
        toFake: ['setTimeout', 'clearTimeout', 'Date'],
      });
      try {
        const {page, context, response, mockRecording, args, filePath} =
          createScreencastMocks(dir.path);
        context.ensureExtension.resolves(filePath);
        await startScreencast(args).handler(
          {params: {filePath, maxDurationMs: 1_000}, page},
          response,
          context,
        );
        await clock.tickAsync(1_000);
        const data = page.setScreenRecorder.firstCall.args[0];
        assert.ok(data);
        await data.stopping;
        page.getScreenRecorder.returns(data);

        await stopScreencast(args).handler(
          {params: {}, page},
          response,
          context,
        );

        sinon.assert.calledOnce(mockRecording.stop);
        sinon.assert.calledWithExactly(page.setScreenRecorder.secondCall, null);
        const text = response.appendResponseLine.lastCall.args[0];
        assert.match(text, /stopped automatically at maxDurationMs/);
      } finally {
        clock.restore();
      }
    });
  });

  it('records two pages concurrently (e2e)', async () => {
    using tmpDir = createTempDir();
    await withMcpContext(async (response, context, args) => {
      const page1 = context.getSelectedMcpPage();
      const page2 = await context.newPage();
      await page1.pptrPage.setContent(html`<h1>Page 1</h1>`);
      await page2.pptrPage.setContent(html`<h1>Page 2</h1>`);

      const filePath1 = path.join(tmpDir.path, 'page1.mp4');
      const filePath2 = path.join(tmpDir.path, 'page2.mp4');

      await startScreencast(args).handler(
        {params: {filePath: filePath1}, page: page1},
        response,
        context,
      );
      await startScreencast(args).handler(
        {params: {filePath: filePath2}, page: page2},
        response,
        context,
      );

      await page1.pptrPage.evaluate(() => {
        document.body.style.background = 'red';
      });
      await page2.pptrPage.evaluate(() => {
        document.body.style.background = 'blue';
      });

      await stopScreencast(args).handler(
        {params: {}, page: page1},
        response,
        context,
      );
      await stopScreencast(args).handler(
        {params: {}, page: page2},
        response,
        context,
      );

      for (const filePath of [filePath1, filePath2]) {
        const content = await fs.readFile(filePath);
        assert.ok(content.length > 0, `${filePath} should not be empty`);
        // MP4 files start with a size-prefixed `ftyp` box.
        assert.strictEqual(content.subarray(4, 8).toString(), 'ftyp');
      }
    });
  });
});
