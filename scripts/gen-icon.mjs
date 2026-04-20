#!/usr/bin/env node
// Render build/icon.svg → build/icon.png (1024x1024).
// electron-builder picks up build/icon.png automatically for macOS + Linux
// packaging and derives the other sizes from it.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(ROOT, 'build', 'icon.svg');
const pngPath = join(ROOT, 'build', 'icon.png');

const svg = await readFile(svgPath, 'utf8');
const resvg = new Resvg(svg, {
  background: 'rgba(0,0,0,0)',
  fitTo: { mode: 'width', value: 1024 },
});
const png = resvg.render().asPng();
await writeFile(pngPath, png);

console.log(`gen-icon: wrote ${pngPath} (${png.length} bytes)`);
