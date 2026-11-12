import { copyFile, mkdir, rm } from 'node:fs/promises';

// Publish only the standalone game, never the test cabinet or dev dependencies.
// The page, its stylesheet, and its scripts are separate files so the Content
// Security Policy can forbid inline code; every published asset is listed here.
await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });
for (const file of ['index.html', 'style.css', 'src/theme.js', 'src/main.js']) {
  await copyFile(file, `dist/${file}`);
}
