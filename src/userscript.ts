/**
 * The userscript entry point.
 *
 * ## Why this file exists
 *
 * The library (`@mg.js/bootstrapped`) is a **library**: it defines `BootstrappedClient` and a few hundred other things and
 * then does nothing at all. That is correct for a library, and it is what `dist/index.js` is for.
 *
 * It is *not* what a userscript should be. A userscript's whole contract is "I install you, you do
 * something". Until this file existed, installing `magicgarden.user.js` produced **no visible effect
 * whatsoever**: no console line, no badge, no hint that anything had happened. A user who installs a
 * mod and sees nothing reasonably concludes it is broken.
 *
 * So this entry point is the "do something" half:
 *
 *   1. installs the client immediately (at `document-start`, before the game's own scripts run);
 *   2. prints a startup line to the console, including the attachment report;
 *   3. renders a small status badge so the install is *visible*;
 *   4. exposes the live client on the page as well as on the sandboxed global, so it is reachable from
 *      the devtools console either way.
 *
 * ## Why a badge and not a panel
 *
 * This is a wrapper, not a mod. It has no feature UI of its own: that is what a mod built *on* it
 * provides. The badge is the minimum needed to answer "is it working?", and it is small enough to be
 * harmless on the game screen. It is isolated in a shadow root so the game's stylesheet cannot reach it
 * and it cannot reach the game's.
 *
 * ## Failure is reported, never swallowed
 *
 * A userscript that silently does nothing on an unsupported build is the worst outcome, because it is
 * indistinguishable from a userscript that is not installed. Every failure path here writes to the
 * console *and* shows up in the badge text.
 */

import { unrefTimer } from '@mg.js/common';

import type { BootstrappedClientOptions } from '@mg.js/bootstrapped';
import { BootstrappedClient } from '@mg.js/bootstrapped';
import { defineGlobal, onTeardown } from '@mg.js/bootstrapped';
import { getPage } from '@mg.js/bootstrapped';

import type { BadgeHandle } from './badge.js';
import { createBadge } from './badge.js';

/** How often the badge re-reads client state, in ms. */
const REFRESH_MS = 500;

/**
 * Wait until there is a `<body>` to attach to.
 *
 * A userscript runs at `document-start`, where `document.body` is usually still `null`. Appending to
 * `documentElement` works, but appending to `body` is tidier and avoids being inside `<head>`. Either
 * way this must never block installation, so it is a best-effort upgrade.
 */
function whenBody(doc: Document, callback: (doc: Document) => void): void {
  if (doc.body) {
    callback(doc);
    return;
  }
  doc.addEventListener(
    'DOMContentLoaded',
    () => {
      callback(doc);
    },
    { once: true },
  );
}

/**
 * What {@link startUserscript} hands back.
 *
 * `client` is the live client, and `stop()` releases everything this entry installed: the two pollers, the
 * badge host, and the client itself. The page also carries a client reached through the namespace
 * (`window.__mgjs.globals.client`), but that path only exists when the page realm is reachable, and it
 * cannot be called synchronously by whatever started the script. The handle exists for that case.
 */
export interface UserscriptHandle {
  readonly client: BootstrappedClient;
  /** Release the pollers, the badge and the client. Idempotent: a second call is a no-op. */
  stop(): Promise<void>;
}

/**
 * Install the client and surface what happened.
 *
 * Options are passed straight through to {@link BootstrappedClient}, so a caller can bound the
 * attachment waits, and so a test can drive this function without leaving a 20-second timer pending.
 */
export function startUserscript(options: BootstrappedClientOptions = {}): UserscriptHandle | null {
  const page = (() => {
    try {
      return getPage();
    } catch (error) {
      // A missing page realm means this is not running inside the game's page at all.
      console.error('[mg.js] could not reach the page realm:', error);
      return null;
    }
  })();

  if (page === null) {
    console.error(
      '[mg.js] no page realm available. This build must run as a userscript with @grant unsafeWindow ' +
        'on https://magicgarden.gg/*.',
    );
    return null;
  }

  // `start()` is async: its page check is a rejection rather than a synchronous throw, so the failure is
  // reported from the promise. The client is still published below whatever happens, so a mod that reads
  // `__mgjs.globals.client` during that window gets the object rather than `undefined`.
  const client = new BootstrappedClient(options);
  void client.start().catch((error: unknown) => {
    console.error('[mg.js] start() failed:', error);
  });

  console.info(
    '%c[mg.js]%c started, attaching to the game connection',
    'background:#2e7d32;color:#fff;padding:1px 5px;border-radius:3px;font-weight:bold',
    'color:inherit',
  );

  // Publish the client *inside* the namespace, under the key the namespace design reserves for page globals.
  //
  // This used to be `page['__mgjs'] = client`, which is the namespace's own key: `getNamespace`
  // validates what it finds there and throws on anything that is not a namespace, so that write
  // destroyed the registry this client had just claimed. The consequence was not cosmetic: `onTeardown`
  // below calls `getNamespace`, so it threw, which meant the pollers and the badge never had a teardown
  // registered at all, and a second load could not claim the namespace either. `defineGlobal` is the
  // supported path and had no caller until now.
  try {
    defineGlobal('client', client, page);
  } catch {
    // A page whose namespace is a foreign value is a page this script cannot publish on; the handle below
    // still gives the caller the client.
  }

  // The sandbox global is a *different* object from the page under `@grant unsafeWindow`, and publishing
  // there is a convenience for the sandbox console. When it is the same object (no sandbox), that write
  // would be the clobber described above, so it is skipped rather than repeated.
  try {
    if ((globalThis as unknown) !== (page as unknown)) {
      (globalThis as unknown as Record<string, unknown>)['__mgjs'] = client;
    }
  } catch {
    // Ditto.
  }

  const doc = (page as unknown as { document?: Document }).document;
  let badge: BadgeHandle | null = null;
  let stopped = false;

  if (doc) {
    try {
      whenBody(doc, (d) => {
        // `whenBody` fires asynchronously at `document-start`, so a `stop()` can land before the body exists.
        // Without this guard the host is created after the teardown has already run and nothing destroys it.
        if (stopped) return;
        badge = createBadge(d);
      });
    } catch (error) {
      // A badge that cannot be created must not stop the wrapper working.
      console.warn('[mg.js] could not create the status badge (the wrapper still works):', error);
    }
  }

  // Poll rather than subscribe: attachment is asynchronous and can be re-run when the game replaces its
  // socket, so there is no single event that covers every transition. 500ms of a few property reads is
  // far cheaper than what the game itself does per frame.
  const timer = setInterval(() => {
    if (stopped) return;
    const report = client.attachmentReport;
    const ready = client.isReady;
    const kind = client.attachmentKind;
    const playerId = client.selfPlayerId;
    const stats = client.store.stats;

    if (!badge) return;

    if (ready) {
      badge.setStatus(`mg.js · ready · ${playerId ?? 'no id'}`, 'ready');
    } else if (kind !== null) {
      badge.setStatus(`mg.js · attached (${kind}) · waiting for Welcome`, 'attached');
    } else {
      badge.setStatus('mg.js · waiting for the game connection', 'starting');
    }

    badge.setDetail([
      `attach kind : ${kind ?? '(not yet attached)'}`,
      `ready       : ${ready}`,
      `playerId    : ${playerId ?? '-'}`,
      `state ver   : ${stats.version}`,
      `patches     : ${stats.patchCount} applied, ${stats.patchFailures} failed`,
      `renumbering : ${report?.renumberingInstalled ?? false}`,
      `sockets seen: ${report?.socketsSeen ?? 0}`,
      report?.roomConnectionRejected
        ? `room path rejected: ${report.roomConnectionRejected}`
        : 'room path   : accepted or not attempted',
      '',
      'window.__mgjs.globals.client is the live client.',
    ]);
  }, REFRESH_MS);

  // Report the attachment outcome once it settles, so the console tells the story even with the badge
  // closed.
  let reported = false;
  const reportTimer = setInterval(() => {
    if (reported || client.attachmentReport === null) return;
    reported = true;
    clearInterval(reportTimer);
    const report = client.attachmentReport;
    console.info('[mg.js] attachment report', report);
    if (client.attachmentKind === null && !report.renumberingInstalled) {
      console.warn(
        '[mg.js] no attachment path succeeded yet. If the game is already running, reload the page so ' +
          'the script runs at document-start.',
      );
    }
  }, REFRESH_MS);

  // Keep the process from being kept alive by the timers in a non-browser context (tests, SSR). Both
  // handles are released independently: the copy this replaces only unref'd the badge timer at all when
  // the *report* timer happened to expose `unref`.
  unrefTimer(timer);
  unrefTimer(reportTimer);

  // The badge and both pollers belong to this client's lifetime, so `stop()` releases them. Without this
  // registration `stop()` is "total" only in name: the intervals keep a closure over a client that has been
  // torn down, and the badge keeps painting a session that no longer exists (I7).
  onTeardown(() => {
    clearInterval(timer);
    clearInterval(reportTimer);
    badge?.destroy();
  }, page);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    // Before the client stops, so no poll can observe a torn-down client and repaint the badge.
    clearInterval(timer);
    clearInterval(reportTimer);
    badge?.destroy();
    await client.stop('mg.js userscript stopped');
  };

  return { client, stop };
}
