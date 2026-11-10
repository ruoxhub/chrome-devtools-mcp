/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import {createCliSession, createTempDir, runCli} from '../utils.js';

const DEBUGGER_TOOLS = [
  'debugger_set_breakpoint',
  'debugger_list_breakpoints',
  'debugger_remove_breakpoint',
  'debugger_pause',
  'debugger_resume',
  'debugger_step',
  'debugger_disable',
  'debugger_wait_for_paused',
  'debugger_get_paused_state',
  'debugger_evaluate',
  'debugger_get_object_properties',
  'list_scripts',
  'get_script_source',
  'search_in_scripts',
] as const;

/**
 * A data: URL keeps the fixture independent of the browser's network and of
 * any proxy or host resolution, while still giving the Debugger domain a real
 * script to pause in.
 */
const PAGE_URL =
  'data:text/html,' +
  encodeURIComponent(
    [
      '<title>debugger e2e</title>',
      '<script>',
      'function add(a, b) {',
      '  const sum = a + b;',
      '  return sum;',
      '}',
      'globalThis.add = add;',
      '</script>',
    ].join('\n'),
  );

const SOURCE_LINE = 'const sum = a + b;';

/**
 * A 1-based document line, not a line inside the inline script: the Debugger
 * domain numbers inline scripts from the start of the document, so this is
 * line 4 of the fixture markup above.
 */
const BREAKPOINT_LINE = '4';

/**
 * Points the daemon at an already-running browser when the environment
 * provides one, so the suite never has to launch Chrome.
 */
function chromeArgs(): string[] {
  const url = process.env['CDMCP_E2E_BROWSER_URL']?.trim();
  if (url !== undefined && url !== '') {
    return ['--browserUrl', url];
  }
  const executable = process.env['PUPPETEER_EXECUTABLE_PATH']?.trim();
  return executable === undefined || executable === ''
    ? []
    : ['--executablePath', executable];
}

/** Parses every JSON object line the CLI prints. */
function payloadLines<T>(stdout: string): T[] {
  const payloads: T[] = [];
  for (const line of stdout.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      continue;
    }
    try {
      payloads.push(JSON.parse(trimmed) as T);
    } catch {
      // Not a JSON payload line.
    }
  }
  return payloads;
}

/**
 * Reads the human-readable text of a tool response. Failures are surfaced with
 * the raw output so an unexpected error is easier to diagnose.
 */
function responseText(stdout: string): string {
  for (const payload of payloadLines<{
    message?: unknown;
    text?: unknown;
  }>(stdout)) {
    if (typeof payload.message === 'string') {
      return payload.message;
    }
    if (typeof payload.text === 'string') {
      return payload.text;
    }
  }
  for (const payload of payloadLines<{
    content?: Array<{text?: unknown}>;
  }>(stdout)) {
    const text = payload.content?.[0]?.text;
    if (typeof text === 'string') {
      return text;
    }
  }
  assert.fail(`no tool response in output: ${stdout}`);
}

describe('debugger tools over the CLI', {concurrency: false}, () => {
  it('lists every debugger tool in the CLI help', async t => {
    const sessionId = createCliSession(t);
    const result = await runCli(['--help'], sessionId);
    assert.strictEqual(result.status, 0, `--help failed: ${result.stderr}`);
    for (const name of DEBUGGER_TOOLS) {
      assert.ok(result.stdout.includes(name), `--help is missing ${name}`);
    }
  });

  it('pauses, steps, resumes, searches and exports a real script', async t => {
    const sessionId = createCliSession(t);
    const start = await runCli(['start', ...chromeArgs()], sessionId);
    assert.strictEqual(start.status, 0, `start failed: ${start.stderr}`);

    using dir = createTempDir('debugger-e2e-');
    let pageId: number | undefined;

    try {
      const opened = await runCli(['new_page', PAGE_URL], sessionId);
      assert.strictEqual(
        opened.status,
        0,
        `new_page failed: ${opened.stdout}${opened.stderr}`,
      );

      const selected = /^(\d+): .*\[selected\]$/m.exec(opened.stdout);
      assert.ok(
        selected,
        `new_page did not report a selected page: ${opened.stdout}`,
      );
      pageId = Number(selected[1]);
      const target = String(pageId);

      const before = responseText(
        (
          await runCli(
            ['debugger_get_paused_state', target, '--output-format', 'json'],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        before.includes('not paused'),
        `a fresh page must not be paused, got: ${before}`,
      );

      const breakpoint = responseText(
        (
          await runCli(
            [
              'debugger_set_breakpoint',
              target,
              BREAKPOINT_LINE,
              '--url',
              PAGE_URL,
              '--output-format',
              'json',
            ],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        !breakpoint.includes('not bound'),
        `the breakpoint must resolve, got: ${breakpoint}`,
      );

      // Trigger after the breakpoint is bound so the pause cannot be missed;
      // the evaluation itself returns immediately.
      const scheduled = await runCli(
        [
          'evaluate_script',
          '() => { setTimeout(() => globalThis.add(1, 2), 100); return "scheduled"; }',
          '--pageId',
          target,
        ],
        sessionId,
      );
      assert.strictEqual(
        scheduled.status,
        0,
        `evaluate_script failed: ${scheduled.stderr}`,
      );

      const paused = responseText(
        (
          await runCli(
            [
              'debugger_wait_for_paused',
              target,
              '--timeout',
              '10000',
              '--output-format',
              'json',
            ],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        paused.startsWith('Paused:'),
        `expected a pause, got: ${paused}`,
      );
      assert.ok(
        paused.includes('add'),
        `the pause must be inside add(), got: ${paused}`,
      );

      const stepped = responseText(
        (
          await runCli(
            ['debugger_step', target, 'over', '--output-format', 'json'],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        stepped.startsWith('Paused:'),
        `stepping must land on a pause, got: ${stepped}`,
      );

      await runCli(
        ['debugger_resume', target, '--output-format', 'json'],
        sessionId,
      );
      const afterResume = responseText(
        (
          await runCli(
            ['debugger_get_paused_state', target, '--output-format', 'json'],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        afterResume.includes('not paused'),
        `resume must clear the pause, got: ${afterResume}`,
      );

      const scripts = responseText(
        (
          await runCli(
            [
              'list_scripts',
              target,
              '--urlFilter',
              'data:text/html',
              '--output-format',
              'json',
            ],
            sessionId,
          )
        ).stdout,
      );
      const scriptLine = /^- (\S+) /m.exec(scripts);
      assert.ok(scriptLine, `no script listed: ${scripts}`);
      const scriptId = scriptLine[1];

      const search = responseText(
        (
          await runCli(
            [
              'search_in_scripts',
              target,
              SOURCE_LINE,
              '--output-format',
              'json',
            ],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        !search.startsWith('No matches'),
        `search must find the source line, got: ${search}`,
      );

      const exportPath = path.join(dir.path, 'page.js');
      const exported = responseText(
        (
          await runCli(
            [
              'get_script_source',
              target,
              scriptId,
              '--filePath',
              exportPath,
              '--output-format',
              'json',
            ],
            sessionId,
          )
        ).stdout,
      );
      assert.ok(
        !exported.startsWith('Error'),
        `get_script_source failed: ${exported}`,
      );
      const written = await readFile(exportPath, 'utf8');
      assert.ok(
        written.includes(SOURCE_LINE),
        `the exported script is missing its source: ${written}`,
      );

      await runCli(
        ['debugger_disable', target, '--output-format', 'json'],
        sessionId,
      );
    } finally {
      if (pageId !== undefined) {
        await runCli(['close_page', String(pageId)], sessionId);
      }
    }
  });
});
