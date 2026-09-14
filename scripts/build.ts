/**
 * Userscript bundler for `@mg.js/bootstrapped`.
 *
 * ## Why this exists as a separate step from `tsc`
 *
 * The package has two audiences with incompatible packaging needs, and one compilation cannot serve
 * both:
 *
 *   - **Tampermonkey** needs a single self-contained IIFE with *zero* imports. A userscript is
 *     evaluated as a classic script; a top-level `import` would be a syntax error, and even if it
 *     were not, `@run-at document-start` leaves no time for a module graph to resolve before the
 *     game's own bootstrap code runs. So the userscript build must bundle `@mg.js/common` *into* the
 *     file and wrap it in an IIFE.
 *   - **Other mods** want `import { BootstrappedClient } from '@mg.js/bootstrapped'`, real ESM with
 *     `.d.ts` declarations. That is what `tsc -b` already produces into `dist/`.
 *
 * So `tsc` owns `dist/index.js` + `dist/index.d.ts`, and esbuild owns exactly one artifact:
 * `dist/magicgarden.user.js`. Nothing else is bundled here.
 *
 * ## Why the metadata block is a `banner` and not a string prepended afterwards
 *
 * Tampermonkey only recognises a metadata block that is the very first thing in the file. Emitting it
 * through esbuild's `banner` option makes that placement structural: it cannot drift below a leading
 * comment or `"use strict"` that a later esbuild option might inject. A post-hoc
 * `fs.writeFile(banner + code)` would work today and silently break the day the output format
 * changes.
 *
 * This script runs in Node (it is invoked via `tsx`), so Node built-ins are fine *here*. The
 * no-Node-built-ins rule applies to `src/`, the code that ends up inside the page.
 */

import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
/**
 * The userscript entry point.
 *
 * This is NOT the library barrel (`@mg.js/bootstrapped`'s `index.ts`). That file is a barrel: it
 * defines and exports, and calls nothing. Such a file is correct for `dist/index.js` but produces a
 * userscript that installs and does nothing. `src/main.ts` installs the client, logs a startup line
 * and renders a status badge, so installing the script has an observable effect. It is a separate
 * module from `src/userscript.ts`, which defines `startUserscript` and does nothing on import, so
 * that the function can be imported and tested without starting a second client (Phase 7 Task 7.1).
 */
const entryPoint = resolve(packageRoot, 'src/main.ts');
const outputFile = resolve(packageRoot, 'dist/magicgarden.user.js');

/**
 * Update/install endpoints.
 *
 * These are declared rather than discovered: `@downloadURL`/`@updateURL` must be absolute URLs that
 * are stable *before* the first release exists, so there is nothing in the repository to read them
 * from. They point at *this* repository's own release asset, because this repository is what builds
 * the script. `@mg.js/bootstrapped` is a library: it publishes packages, and no release of it has ever
 * carried, or ever will carry, a `magicgarden.user.js`.
 */
const DOWNLOAD_URL =
  'https://github.com/QenuDev/bootstrapped-example/releases/latest/download/magicgarden.user.js';
const UPDATE_URL = DOWNLOAD_URL;

/**
 * The Tampermonkey metadata block.
 *
 * `@grant unsafeWindow` is not decoration but a requirement: without it Tampermonkey runs the script
 * in a sandbox with its own `window`, and `page = unsafeWindow ?? window` would resolve to that
 * sandbox. Every hook installed on `page` would then be installed on a window the game never
 * touches. See `@mg.js/bootstrapped`'s `page/realm.ts`.
 *
 * `@run-at document-start` matters just as much: the game installs `MagicCircle_RoomConnection`
 * and the Pixi init callbacks during its own bootstrap, so a script that starts later can only
 * observe whatever survived, not wrap it. See `@mg.js/bootstrapped`'s `attach/room-connection.ts`.
 *
 * `GM_getValue`/`GM_setValue` are granted because `@mg.js/bootstrapped`'s `storage/` prefers them over the shadowed
 * `localStorage` fallback (GM storage is shared across the game's own subdomains and survives
 * `localStorage.clear()`).
 */
function metadataBanner(version: string): string {
  return `// ==UserScript==
// @name         magicgarden.js (bootstrapped)
// @namespace    https://github.com/QenuDev/MG.js
// @version      ${version}
// @description  Attach to Magic Garden's own Quinoa connection: typed actions, a live state store, coexistence-safe sequencing, and a Pixi/Rive render layer.
// @author       magicgarden.js contributors
// @match        https://magicgarden.gg/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  ${DOWNLOAD_URL}
// @updateURL    ${UPDATE_URL}
// ==/UserScript==
`;
}

/** Read the package's own version so the metadata block never drifts from `package.json`. */
async function readVersion(): Promise<string> {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const text = await import('node:fs/promises').then((fs) => fs.readFile(pkgUrl, 'utf8'));
  const parsed: unknown = JSON.parse(text);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (parsed as { version?: unknown }).version === 'string'
  ) {
    return (parsed as { version: string }).version;
  }
  throw new Error('build: package.json has no string "version" field to put in the userscript banner.');
}

/** Human-readable byte size, for the build log. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function main(): Promise<void> {
  const version = await readVersion();

  const result = await build({
    entryPoints: [entryPoint],
    outfile: outputFile,
    bundle: true,
    // A userscript is a classic script in a page: no module loader, no external imports.
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    // Readable output is deliberate. This artifact is what a mod author reads in devtools to see what
    // the game is doing; mangled names would cost more than the bytes save, and Tampermonkey users
    // routinely diff these files.
    minify: false,
    // A sourcemap for a userscript has nowhere to live: Tampermonkey would have to serve a second
    // file, and the `//# sourceMappingURL=` comment would point at a local path. Omit it.
    sourcemap: false,
    banner: { js: metadataBanner(version) },
    // Keep the bundle legible: one banner per bundled module would drown the output in licence
    // blocks from `@mg.js/common`, which is first-party and declares none anyway.
    legalComments: 'none',
    logLevel: 'warning',
  });

  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    throw new Error(`build: esbuild reported ${result.errors.length} error(s).`);
  }

  const bundle = await stat(outputFile);
  const prefixBytes = Buffer.byteLength(metadataBanner(version), 'utf8');

  console.log('build:userscript');
  console.log(`  entry    ${entryPoint}`);
  console.log(`  output   ${outputFile}`);
  console.log(
    `  banner   ${formatBytes(prefixBytes)} (${metadataBanner(version).split('\n').length - 1} lines)`,
  );
  console.log(`  bundle   ${formatBytes(bundle.size)} (${bundle.size} bytes)`);
  console.log(`  format   iife / browser / es2022 / unminified`);
}

await main();
