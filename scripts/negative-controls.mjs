import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Each control corrupts one published file in a way the compatibility gate must reject.
const cases = [
  {
    name: 'startup',
    file: 'dist/src/main.js',
    marker: 'negative-control-startup',
    patch: (source) => source.replace("'use strict';", "'use strict'; throw new Error('negative-control-startup');"),
  },
  {
    name: 'asset',
    file: 'dist/index.html',
    marker: 'missing-required-asset.js',
    patch: (source) => source.replace('</head>', '<script src="./missing-required-asset.js"></script></head>'),
  },
  {
    // An inline script must be refused by the Content Security Policy and fail the gate.
    name: 'inline-script',
    file: 'dist/index.html',
    marker: 'Content Security Policy',
    patch: (source) => source.replace('</head>', '<script>window.negativeControlInline = true;</script></head>'),
  },
];
await mkdir('.cache/negative-controls', { recursive: true });
for (const control of cases) {
  const original = await readFile(control.file, 'utf8');
  const patched = control.patch(original);
  if (patched === original) throw new Error(`Negative control ${control.name} did not change ${control.file}.`);
  try {
    await writeFile(control.file, patched);
    const result = spawnSync(process.execPath, [
      'node_modules/@playwright/test/cli.js', 'test',
      '--project=desktop-chromium', '--grep=mouse launch', '--timeout=10000',
      '--reporter=line', `--output=.cache/negative-controls/${control.name}`,
    ], { encoding: 'utf8' });
    if (result.error) throw result.error;
    const log = result.stdout + result.stderr;
    await writeFile(`.cache/negative-controls/${control.name}.log`, log);
    if (result.status !== 1 || !log.includes(control.marker) || !log.includes('1 failed')) {
      throw new Error(`Negative control ${control.name} did not fail as expected:\n${log}`);
    }
    console.log(`PASS: broken candidate ${control.name} rejected (${control.marker}).`);
  } finally {
    await writeFile(control.file, original);
  }
}