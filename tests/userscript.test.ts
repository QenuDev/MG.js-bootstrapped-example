/**
 * The userscript entry: what it publishes on the page, and what its handle releases.
 *
 * ## What these tests are for
 *
 * Phase 7 Tasks 7.1 and 7.2 are one defect seen from two sides, and the tests below are written to fail on
 * both sides before the fix.
 *
 * `NAMESPACE_KEY` is `'__mgjs'`, and `isOurNamespace` requires a `marker` plus a string `version`. The entry
 * wrote the **`BootstrappedClient` itself** to that key, which means `getNamespace` finds a value that is not
 * a namespace and is not `undefined`, and **throws**. The message is *"already exists and was not created
 * by mg.js"*. The ordering is not in doubt: `start()` reaches `claimInstall(page)` with no `await` before it,
 * so the namespace is created synchronously and then destroyed by the entry's own write a few lines later.
 * Three consequences, each with a test here:
 *
 *   - `peekNamespace(page)` is `null` after a successful start, so nothing can find the namespace;
 *   - `client.stop()` throws, because `releaseInstall` calls `getNamespace`. The `onTeardown` that clears the
 *     two pollers and destroys the badge therefore **never runs**, which is 7.1's complaint arriving from
 *     7.2;
 *   - a second load's `claimInstall` throws too, which is 7.2's own complaint.
 *
 * The mechanism for the fix already exists and was dead: `defineGlobal` is documented as the sanctioned way
 * to publish a page global and no file in `src` called it, because the entry hand-wrote the raw key instead.
 *
 * ## Why the DOM stub, and why the entry module is now importable
 *
 * Two of the assertions are about the badge, which is invisible without a document (`tests/fixtures/dom.ts`).
 * And `src/userscript.ts` used to end with a call to `startUserscript()`, so importing it started a second
 * client with its own pollers; that side effect now lives in `src/main.ts`, so these tests can import the
 * function at all.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BootstrappedClientOptions } from '@mg.js/bootstrapped';
import { startUserscript } from '../src/userscript.js';
import { getNamespace, peekNamespace, readGlobal } from '@mg.js/bootstrapped';
import { installRealmOverride } from '@mg.js/bootstrapped';
import type { PageRealm } from '@mg.js/bootstrapped';
import { FakeDocument } from './fixtures/dom.js';

/** The id `src/badge.ts` gives its shadow host. Spelled out so a rename fails here rather than silently. */
const HOST_ID = '__mgjs_status_host';

/**
 * Start with bounded timeouts and the three bridges off.
 *
 * The real defaults are a 20-second attachment wait and a room-upgrade watch; a test that leaves either
 * pending keeps the event loop alive and `node --test` waits for it, and that is how this file hung on its
 * first run. Passing options also means `startUserscript` has to accept them. That change is additive, and
 * it is the reason the handle and the options land together.
 */
function startTestUserscript(options?: BootstrappedClientOptions) {
  return startUserscript(
    options ?? {
      attachTimeoutMs: 5,
      roomUpgradeTimeoutMs: 5,
      roomUpgradeIntervalMs: 1,
      storage: { forceBackend: 'memory' },
      features: { render: false, jotai: false, catalog: false },
    },
  );
}

function withPage(): { page: PageRealm; doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const page: PageRealm = { document: doc };
  const restore = installRealmOverride({ page });
  return { page, doc, restore };
}

/**
 * Replace the timer functions so "the pollers were cleared" is observable without a clock, and so the
 * pollers never actually fire during a test.
 *
 * The fake handle carries `unref`, because the entry calls `unrefTimer` on both of its handles and a bare
 * number would make that call a different code path than the one production takes.
 */
function countTimers(): { live: () => number; restore: () => void } {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const live = new Set<{ unref: () => void }>();

  globalThis.setInterval = ((_handler: () => void, _ms?: number) => {
    const handle = { unref: () => undefined };
    live.add(handle);
    return handle as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: { unref: () => void }) => {
    live.delete(handle);
  }) as unknown as typeof clearInterval;

  return {
    live: () => live.size,
    restore: () => {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    },
  };
}

void test('startUserscript publishes the client inside the namespace, not over it', async () => {
  const { page, restore } = withPage();
  const handle = startTestUserscript();

  try {
    assert.notEqual(handle, null, 'the entry must start on a page with a document');
    // Red before the fix: the entry's raw write left a client under `__mgjs`, and `peekNamespace` validates,
    // so this was null.
    assert.notEqual(peekNamespace(page), null, 'the __mgjs namespace must survive the entry');
    assert.equal(
      readGlobal('client', page),
      handle?.client,
      'the client must be reachable through the namespace registry built for page globals',
    );
  } finally {
    await handle?.stop();
    restore();
    delete (globalThis as unknown as Record<string, unknown>)['__mgjs'];
  }
});

void test('the namespace survives a start, so stop() can run at all', async () => {
  const { page, restore } = withPage();
  const handle = startTestUserscript();

  try {
    // Red before the fix: `getNamespace` throws on a client-shaped `__mgjs`, so this line threw out of
    // `stop()`. The teardown registration therefore never ran and the pollers survived.
    assert.doesNotThrow(() => getNamespace(page));
    await handle?.stop();
  } finally {
    await handle?.stop();
    restore();
    delete (globalThis as unknown as Record<string, unknown>)['__mgjs'];
  }
});

void test('a second load shares the namespace instead of throwing', async () => {
  const { page, restore } = withPage();
  const first = startTestUserscript();
  const second = startTestUserscript();

  try {
    assert.notEqual(peekNamespace(page), null, 'the first load must leave a namespace to share');
    assert.equal(getNamespace(page).refCount, 2, 'two loads are two claims on one namespace');

    await second?.stop();
    assert.equal(getNamespace(page).refCount, 1, 'releasing one load must leave the other installed');
  } finally {
    await first?.stop();
    restore();
    delete (globalThis as unknown as Record<string, unknown>)['__mgjs'];
  }
});

void test("the handle's stop clears both pollers and removes the badge host", async () => {
  const timers = countTimers();
  const { doc, restore } = withPage();
  const handle = startTestUserscript();

  try {
    doc.fireBodyReady();
    assert.equal(
      doc.hasElement(HOST_ID),
      true,
      'the badge host must exist before stop(), or this is vacuous',
    );

    await handle?.stop();

    assert.equal(doc.hasElement(HOST_ID), false, 'stop() must remove the badge host');
    assert.equal(timers.live(), 0, 'stop() must leave no interval running');
  } finally {
    timers.restore();
    await handle?.stop();
    restore();
    delete (globalThis as unknown as Record<string, unknown>)['__mgjs'];
  }
});

void test('a badge that arrives after stop() is not left behind', async () => {
  // The residual leak this task closes: `badge` is assigned inside `whenBody`'s callback, so a stop() that
  // runs before `DOMContentLoaded` sees `badge === null`, and the callback then creates a host that nothing
  // will ever destroy. A userscript can be stopped that early by a mod importing the library and calling
  // stop() synchronously.
  const timers = countTimers();
  const { doc, restore } = withPage();
  const handle = startTestUserscript();

  try {
    assert.equal(doc.body, null, 'this test is only meaningful before the body exists');
    await handle?.stop();
    assert.equal(doc.hasElement(HOST_ID), false, 'stop() must not leave a host behind for a later body');

    doc.fireBodyReady();

    assert.equal(
      doc.hasElement(HOST_ID),
      false,
      'a host created after stop() has nobody to destroy it, so stop() must prevent its creation',
    );
  } finally {
    timers.restore();
    await handle?.stop();
    restore();
    delete (globalThis as unknown as Record<string, unknown>)['__mgjs'];
  }
});
