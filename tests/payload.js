import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
export const baselinePath = fileURLToPath(new URL('./payload-baseline.json', import.meta.url));

const textFile = /\.(?:html|css|js|mjs|json|svg|txt)$/i;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

// Sizes as the site publishes them: Git normalises text files to LF on commit, so a CRLF
// checkout must not inflate the numbers, and a static host compresses each file on its own,
// so gzip is summed per file.
export function measurePayload(root = distRoot) {
  const files = {};
  let raw = 0;
  let gzip = 0;
  for (const path of [...walk(root)].sort()) {
    let buffer = readFileSync(path);
    if (textFile.test(path)) buffer = Buffer.from(buffer.toString('utf8').replaceAll('\r\n', '\n'));
    files[relative(root, path).split(sep).join('/')] = buffer.length;
    raw += buffer.length;
    gzip += gzipSync(buffer).length;
  }
  return { raw, gzip, files };
}
