/**
 * The userscript entry point: start, and never throw into the game page.
 *
 * ## Why this is a module of its own
 *
 * `src/userscript.ts` used to end with this invocation, on the stated grounds that "this invocation is the
 * entire reason this module exists". It is the reason a *bundle* exists, but not the reason that module does:
 * a module-level side effect means importing `startUserscript` in order to test it, or to hold its handle, also
 * starts a second client with its own pollers and badge, against whatever page the importer happens to have.
 * Phase 7 Task 7.1 needs exactly that import, and its acceptance is "a test that fails without the handle", so
 * the side effect had to move rather than be worked around.
 *
 * The invocation is unchanged in behaviour: `startUserscript()` is called once at module load, and a failure
 * is logged rather than thrown, so a broken start can never break the game page.
 */

import { startUserscript } from './userscript.js';

try {
  startUserscript();
} catch (error) {
  console.error('[mg.js] startup failed:', error);
}
