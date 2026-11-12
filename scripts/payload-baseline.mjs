import { existsSync, writeFileSync } from 'node:fs';
import { baselinePath, distRoot, measurePayload } from '../tests/payload.js';

// Records the current build output as the payload budget baseline. Run it only when a
// larger payload is intended, after `npm run build`, and commit the result with the change.
if (!existsSync(distRoot)) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}
const payload = measurePayload();
writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Recorded ${Object.keys(payload.files).length} files: raw ${payload.raw} B, gzip ${payload.gzip} B.`);
