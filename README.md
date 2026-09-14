# bootstrapped-example

The example Magic Garden userscript, built on [`@mg.js/bootstrapped`](https://www.npmjs.com/package/@mg.js/bootstrapped)
as a library. The repository is kept separate on purpose, so the library cannot grow application code: this repo
consumes the library through its published entry point and has no access to its internals.

**This repository is GitHub-only.** It is not published to any registry and, being a userscript, it never will
be: [GitHub Releases](https://github.com/QenuDev/bootstrapped-example/releases) is where its artifact goes.
The library it builds on is the thing that publishes packages.

## What is here

| Path | Role |
|---|---|
| `src/main.ts` | the bundle entry: starts the client once, and never throws into the game page |
| `src/userscript.ts` | `startUserscript()`: wires the client, the page namespace and the status badge |
| `src/badge.ts` | the shadow-DOM status badge |
| `scripts/build.ts` | esbuild bundling plus the Tampermonkey `==UserScript==` banner |
| `tests/` | the userscript's own tests, including a minimal DOM stub |

## How `@mg.js/*` resolves

The library lives in another repository, [`QenuDev/MG.js`](https://github.com/QenuDev/MG.js), and this repository
consumes it **from the npm registry**, at `^0.1.0` for both packages, so a lone checkout is all `npm ci` needs:

```json
"dependencies": {
  "@mg.js/bootstrapped": "^0.1.0",
  "@mg.js/common": "^0.1.0"
}
```

To iterate on the library and this script together, point npm at the checkout instead:

```bash
npm --prefix ../mg.js run build
npm link ../mg.js/packages/bootstrapped ../mg.js/packages/common
```

That is the whole cost of depending on a published artifact rather than a `file:` path: `npm install` replaces
the links with the registry copies, so you re-link after any install. What it buys is a dependency that resolves
anywhere, since `file:` paths point outside this repository and cannot resolve on a runner. The release workflow
above could never have used them.

The published packages carry their built `dist/`, so nothing here reads the library's `src/`. If this repo
needed `src/`, the boundary would not exist.

## Commands

```bash
npm install
npm run verify     # tsc -b, then bundle, then the tests, then the size budget
```

Tagging `v<version>` builds the bundle and attaches `dist/magicgarden.user.js` to a GitHub release. See
[`.github/workflows/release.yml`](.github/workflows/release.yml). The asset's basename must stay
`magicgarden.user.js`, because that is the path the banner's `@downloadURL` names.
