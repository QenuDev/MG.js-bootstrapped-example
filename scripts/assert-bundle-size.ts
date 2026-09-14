/**
 * The userscript's size budget: one constant, two consumers.
 *
 * `packages/bootstrapped/tests/build-output.test.ts` asserts the ceiling against the built artifact, and
 * `npm run size` fails the gate from the command line. Both import the numbers from here, so a budget
 * change is one edit rather than a number that drifts in two places.
 *
 * ## Why a budget at all
 *
 * Until now the only size assertion in the repo was `stats.size > 20_000`, a floor that catches esbuild
 * emitting a stub, and nothing else. The artifact grew from ~250 KiB to 276 KiB with no gate noticing,
 * which is fine until the day it is 2 MB, because at that point the userscript's install and update cost
 * has changed for every user and nobody can say when it happened.
 *
 * The budget is loose: this is a tripwire for "something got inlined", not a performance
 * target. The userscript inlines the whole of `@mg.js/common`, so a few hundred KiB is the expected shape.
 *
 *   - **fail** above 600 KiB: almost certainly an accidental dependency or a lost `external`.
 *   - **warn** above 500 KiB: headroom spent, worth a look at what grew.
 *
 * ## Why the lines moved (2026-09-13)
 *
 * 300/320 KiB was chosen against a 276.2 KiB artifact, i.e. roughly +9% and +16% of slack. Both lines
 * were then overtaken by Phase 1 to 4, which added ~37 KB (+13%): the artifact reached **319,887 B**, so
 * the warning line was crossed on every run. A warning that always fires carries no information. Only
 * **7,793 B** remained under the ceiling, which made a structural phase (moving files, not adding
 * behaviour) capable of failing a size gate. Raised to 500/600 KiB on the maintainer's explicit
 * instruction, as a **deliberate, revisitable** decision rather than a reflex to a red build.
 *
 * This is recorded because raising a budget silently is how a gate stops being one. 600 KiB is still a
 * tripwire, not a target, and it is not derived from any platform limit (Greasy Fork, the nearest
 * real constraint, caps scripts at 2 MB). What the ceiling should eventually be is an open question; that
 * 320 KiB was never justified against anything except the artifact's size that day is not.
 *
 * ## The baseline is a measurement, not a guess
 *
 * `BASELINE_BYTES` was **282,800 bytes (276.2 KiB)** from the day this file was written (2026-09-13) until
 * Phase 4.5, while the artifact had grown to ~304 KiB. That made the printed `+N B vs baseline` delta
 * meaningless: it claimed roughly 25 kB of growth that had accumulated over many commits and could not be
 * attributed to the change under review. It is now the exact byte size of the artifact measured on
 * 2026-09-13 after the Phase 4.5 build, so the delta it prints is the growth since that measurement.
 *
 * Refresh it on purpose, never as a reflex to make a delta look small: rebuild
 * (`npm run build`), confirm the new size is understood and wanted, then paste the exact `stat -c%s`
 * value here in the same commit that explains the growth. The warn (500 KiB) and fail (600 KiB) lines are
 * the gate; the baseline only explains *how much* has changed since it was last taken.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Above this, the gate fails. 600 KiB. */
export const FAIL_BYTES = 600 * 1024;

/** Above this, the gate warns. 500 KiB. */
export const WARN_BYTES = 500 * 1024;

/**
 * The last measured artifact size, for the delta line. Exact `stat -c%s` of
 * `packages/bootstrapped/dist/magicgarden.user.js` after the Phase 4.5 build on 2026-09-13.
 *
 * A real measurement, not the historical ~276 KiB it replaced: an out-of-date baseline makes the printed
 * delta attribute unrelated growth to the change under review. See the header for when and how to refresh
 * it. It does not gate anything; `WARN_BYTES` and `FAIL_BYTES` do.
 */
export const BASELINE_BYTES = 314_423;

/** What a size check concluded. Diagnostic on purpose: a bare boolean cannot explain itself. */
export interface SizeVerdict {
  readonly bytes: number;
  readonly kib: string;
  readonly level: 'ok' | 'warn' | 'fail';
  /** One line, ready to print. Always names the measured size. */
  readonly message: string;
}

/** Judge a bundle size against the budget. Pure, so a test can exercise every branch. */
export function checkBundleSize(bytes: number, baseline: number = BASELINE_BYTES): SizeVerdict {
  const kib = `${(bytes / 1024).toFixed(1)} KiB`;
  const delta = bytes - baseline;
  // The baseline's value is named as well as the difference: `+1234 B` alone cannot be checked by a reader
  // who does not already know what it was measured against.
  const deltaText =
    delta === 0
      ? `unchanged from the ${baseline} B baseline`
      : `${delta > 0 ? '+' : ''}${delta} B vs the ${baseline} B baseline`;

  if (bytes > FAIL_BYTES) {
    return {
      bytes,
      kib,
      level: 'fail',
      message:
        `bundle ${kib} (${bytes} B) exceeds the ${FAIL_BYTES} byte budget by ${bytes - FAIL_BYTES} B. ` +
        `The delta is ${deltaText}. Something was inlined or lost an \`external\`; check ` +
        `packages/bootstrapped/scripts/build.ts before raising this budget.`,
    };
  }
  if (bytes > WARN_BYTES) {
    return {
      bytes,
      kib,
      level: 'warn',
      message: `bundle ${kib} (${bytes} B) is over the ${WARN_BYTES} byte warning line: ${deltaText}.`,
    };
  }
  if (bytes < FAIL_BYTES / 8) {
    // A floor, because a *small* bundle is the failure nobody looks for: esbuild emitting a stub after a
    // bad entry path would sail through a ceiling-only check.
    return {
      bytes,
      kib,
      level: 'fail',
      message:
        `bundle ${kib} (${bytes} B) is far too small to contain @mg.js/common, so the entry point ` +
        `probably did not resolve.`,
    };
  }
  return { bytes, kib, level: 'ok', message: `bundle ${kib} (${bytes} B): within budget, ${deltaText}.` };
}

/** The artifact this budget is about. */
export function artifactPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../dist/magicgarden.user.js',
  );
}

function main(): void {
  const path = artifactPath();
  if (!existsSync(path)) {
    console.error(`[size] ${path} does not exist, so run \`npm run build\` first.`);
    process.exitCode = 2;
    return;
  }
  const verdict = checkBundleSize(statSync(path).size);
  const line = `[size] ${verdict.message}`;
  if (verdict.level === 'fail') {
    console.error(line);
    process.exitCode = 1;
  } else if (verdict.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// Only when executed as a script: importing this module from a test must not run the CLI.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
