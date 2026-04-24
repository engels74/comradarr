---
type: "agent_requested"
description: "SvelteKit 2 + Svelte 5 + Bun + UnoCSS + shadcn-svelte Development Guidelines"
---

# SvelteKit 2 + Svelte 5 + Bun + UnoCSS + shadcn-svelte Development Guidelines

## 0. Agent Operating Contract

This document is **strict law** for AI coding agents working on projects using SvelteKit 2, Svelte 5 Runes, Bun, UnoCSS (presetWind4 + presetShadcn), shadcn-svelte, svelte-adapter-bun, and an openapi-typescript + openapi-fetch client against a Litestar OpenAPI spec.

Behavioral contract:

- **Follow** every `RULE-*` as non-negotiable law.
- **Use** `DECIDE-*` trees before choosing an abstraction; never invent an alternative path.
- **Copy** `PATTERN-*` snippets for new code; adapt names/types only.
- **Use** `RECIPE-*` workflows end-to-end when the described task is being performed.
- **Reject** every `ANTI-*` on sight. If existing code contains one within the modified file or module, refactor it toward the documented replacement as part of the change.
- **Run** `VERIFY-*` commands after any non-trivial change and before claiming completion.
- **Prefer Stable** over Conditional. Only invoke a Conditional pattern when its activation conditions are explicitly met. Never invoke a Rejected pattern.
- For **existing code**: when modifying a file, move nearby touched code (same file, adjacent symbols) toward these guidelines. Preserve runtime behavior unless the user explicitly requests a behavior change. Announce any refactor larger than the local change to the user before executing it.
- When **uncertain**, prefer a conservative Stable default; do not invent rules or cite unsourced behavior.

## 0.1 How to Search This Document

Agents should resolve questions by searching IDs in this order:

1. `RULE-*` — Is there a hard law covering this?
2. `DECIDE-*` — Is there a decision tree for this abstraction?
3. `PATTERN-*` — Is there a canonical snippet?
4. `RECIPE-*` — Is there a full workflow?
5. `ANTI-*` — Is the candidate approach forbidden?
6. `VERIFY-*` — What commands validate the work?
7. `SOURCE-*` — What evidence supports the rule?

Stack-specific search examples:

- "How do I declare component state?" → `RULE-RUNES-*`, `PATTERN-STATE-*`, `ANTI-SVELTE4-*`.
- "How do I load data for a route?" → `DECIDE-LOAD-*`, `PATTERN-LOAD-*`, `ANTI-SK1-*`.
- "How do I call the backend API?" → `DECIDE-API-*`, `PATTERN-OAPI-*`, `RECIPE-OAPI-CLIENT`.
- "Which package manager command?" → `RULE-BUN-*`, `ANTI-PM-*`, `VERIFY-*`.
- "How do I style a component?" → `RULE-UNO-*`, `PATTERN-UNO-*`, `ANTI-TW-*`.

## 1. Stack Snapshot

| Layer | Technology | Stable version at time of writing | Role |
|---|---|---|---|
| UI framework | Svelte | 5.x (runes GA) | Component model, reactivity via runes ([Source](https://svelte.dev/blog/runes)) |
| App framework | SvelteKit | 2.x | Routing, SSR, load functions, form actions, hooks ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2)) |
| Runtime & PM | Bun | 1.3.x (text lockfile default since 1.2) | `bun install`, `bun run`, `bun test`, `bun`-powered production server ([Source](https://bun.com/docs/pm/lockfile)) ([Source](https://bun.com/)) |
| Adapter | `svelte-adapter-bun` (gornostay25) | 1.0.1 | Standalone Bun server build output ([Source](https://www.npmjs.com/package/svelte-adapter-bun)) |
| CSS engine | UnoCSS | 66.x | `presetWind4` (Tailwind v4-compatible) atomic CSS ([Source](https://unocss.dev/presets/wind4)) |
| Shadcn bridge | `unocss-preset-shadcn` | 1.x (presetWind4 default) | Generates shadcn theme CSS variables under UnoCSS ([Source](https://github.com/unocss-community/unocss-preset-shadcn)) |
| Component library | `shadcn-svelte` | 1.1.x | Copy-in components powered by Bits UI ([Source](https://www.npmjs.com/package/shadcn-svelte)) |
| API types | `openapi-typescript` | 7.x | OpenAPI 3.x → TypeScript types ([Source](https://openapi-ts.dev/cli)) |
| API client | `openapi-fetch` | current | Thin typed `fetch` wrapper driven by generated types ([Source](https://openapi-ts.dev/openapi-fetch/)) |
| Backend (spec source) | Litestar | 2.x | OpenAPI 3.1 schema served at `/schema/openapi.json` ([Source](https://docs.litestar.dev/2/usage/openapi/schema_generation.html)) |

## 2. Status & Adoption Policy

Every major entry is one of:

- **Stable** — default for new code. Refactor toward it when touching nearby code.
- **Conditional** — permitted only when the stated activation condition holds. Each Conditional entry states: activation condition, problem solved vs. the Stable default, the Stable fallback, and rollback risk.
- **Reject** — forbidden. Each Reject entry states: the rejected pattern, why, replacement, and migration note for existing code.

Source traceability: every version-sensitive, deprecation, security, migration, Conditional, or Reject claim must map to a `SOURCE-*` entry in §15.

## 3. Rule Index

**Language & runes**
`RULE-RUNES-001` `RULE-RUNES-002` `RULE-RUNES-003` `RULE-RUNES-004` `RULE-EVENTS-001` `RULE-SNIPPETS-001`

**SvelteKit routing & data**
`RULE-SK-FILES-001` `RULE-SK-LOAD-001` `RULE-SK-ERROR-001` `RULE-SK-STATE-001` `RULE-SK-FETCH-001` `RULE-SK-FORMS-001` `RULE-SK-SERVERONLY-001`

**Package manager & runtime**
`RULE-BUN-001` `RULE-BUN-002` `RULE-BUN-003` `RULE-BUN-004`

**Styling**
`RULE-UNO-001` `RULE-UNO-002` `RULE-UNO-003` `RULE-SHADCN-001` `RULE-SHADCN-002`

**API client**
`RULE-OAPI-001` `RULE-OAPI-002` `RULE-OAPI-003`

**Security & config**
`RULE-SEC-001` `RULE-SEC-002` `RULE-SEC-003`

**Decisions**
`DECIDE-RUNE-001` `DECIDE-LOAD-001` `DECIDE-STATE-001` `DECIDE-API-001` `DECIDE-STYLE-001` `DECIDE-FORM-001`

**Anti-patterns (top)**
`ANTI-SVELTE4-001` `ANTI-SVELTE4-002` `ANTI-SVELTE4-003` `ANTI-SK1-001` `ANTI-SK1-002` `ANTI-PM-001` `ANTI-TW-001` `ANTI-REACT-001`

## 4. Hard Rules

### Language, reactivity, components

- **RULE-RUNES-001 — Svelte 5 Runes are mandatory (Stable).** Declare reactive state with `$state`, derived values with `$derived`, props with `$props`, and bindable props with `$bindable`. Do not use Svelte 4's `let count = 0` as reactive state, `$:` labels, `export let`, or `createEventDispatcher`. Event handlers are plain attributes: `onclick`, `onsubmit`, `oninput`. ([Source](https://svelte.dev/docs/svelte/v5-migration-guide)) ([Source](https://svelte.dev/blog/runes))
- **RULE-RUNES-002 — Prefer `$derived` over `$effect` for computed values (Stable).** Use `$effect` only for side effects (DOM, subscriptions, logging). Mutating `$state` inside `$effect` is a code smell; reach for `$derived`, `$derived.by`, or bindings first. ([Source](https://svelte.dev/docs/svelte/$effect)) ([Source](https://github.com/sveltejs/svelte/issues/10193))
- **RULE-RUNES-003 — Shared reactive state lives in `.svelte.ts` / `.svelte.js` modules (Stable).** Export a function, class, or object with getters — never export a primitive directly, because importers receive a non-reactive copy. ([Source](https://joyofcode.xyz/how-to-share-state-in-svelte-5)) ([Source](https://dev.to/mandrasch/svelte-5-share-state-between-components-for-dummies-4gd2))
- **RULE-RUNES-004 — Do not put mutable global `$state` in server-reachable modules (Stable).** `$state` initialized at module top level persists across SvelteKit requests on the server and will leak data between users. Per-request state must go through `event.locals`, `+*.server.ts` return values, or context. ([Source](https://github.com/sveltejs/kit/issues/12507)) ([Source](https://svelte.dev/docs/kit/state-management))
- **RULE-EVENTS-001 — Use lowercase HTML event attributes (Stable).** `onclick={...}`, not `on:click={...}`. `on:` is the Svelte 4 legacy syntax. ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- **RULE-SNIPPETS-001 — Use snippets + `{@render ...}` instead of slots (Stable).** Named slots and `<slot>` are legacy. Use `{#snippet name(args)}...{/snippet}` and `{@render children?.()}`. ([Source](https://svelte.dev/docs/svelte/@render)) ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))

### SvelteKit routing & data flow

- **RULE-SK-FILES-001 — Respect SvelteKit 2 route file conventions.** Routes live in `src/routes/`. Use `+page.svelte`, `+page.ts` (universal), `+page.server.ts` (server-only), `+layout.svelte`, `+layout.ts`, `+layout.server.ts`, `+server.ts` (endpoints), `+error.svelte`, `hooks.server.ts`, `hooks.client.ts`. Shared library code lives in `src/lib/`; server-only code in `src/lib/server/`. ([Source](https://svelte.dev/docs/kit/load)) ([Source](https://svelte.dev/docs/kit/server-only-modules/llms.txt))
- **RULE-SK-LOAD-001 — Prefer server load functions for protected or secret-reading data (Stable).** Use `+page.server.ts` / `+layout.server.ts` when the code touches databases, cookies, private env vars, or internal APIs. Use `+page.ts` / `+layout.ts` for data fetched from an already-public API that is safe to expose. ([Source](https://svelte.dev/docs/kit/load))
- **RULE-SK-ERROR-001 — Call `error(...)` and `redirect(...)`; do not `throw` them (Stable).** In SvelteKit 2 the functions return/throw internally; calling them is enough. Importantly, `redirect(...)` thrown inside a `try/catch` will be swallowed — use it outside catch blocks or rethrow. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2)) ([Source](https://github.com/sveltejs/kit/issues/8689))
- **RULE-SK-STATE-001 — Use `$app/state` (not `$app/stores`) on SvelteKit ≥ 2.12 + Svelte 5 (Stable).** Import `page`, `navigating`, `updated` from `$app/state`; read as plain properties (`page.url.pathname`), not `$page.url.pathname`. `$app/stores` is deprecated in this environment. ([Source](https://svelte.dev/docs/kit/$app-state)) ([Source](https://svelte.dev/docs/kit/$app-stores))
- **RULE-SK-FETCH-001 — In load functions, use the `fetch` argument, not global `fetch` (Stable).** The framework-provided `fetch` supports relative URLs during SSR, forwards cookies/headers, and coalesces internal `+server.ts` calls without an HTTP round-trip. ([Source](https://svelte.dev/docs/kit/load))
- **RULE-SK-FORMS-001 — Use form actions + `use:enhance` for mutations (Stable).** Place server logic in `+page.server.ts` `actions = { ... }`. On the client import `enhance` from `$app/forms` and progressively enhance `<form method="POST" use:enhance>`. ([Source](https://svelte.dev/docs/kit/form-actions)) ([Source](https://blog.ethercorps.io/blog/sveltekit-changes-form-actions-and-progressive-enhancement-31h9))
- **RULE-SK-SERVERONLY-001 — Gate server-only code with `$lib/server/` or `.server.ts` (Stable).** Private env (`$env/static/private`, `$env/dynamic/private`), DB clients, and secret handlers must be imported only from server modules. SvelteKit's compiler will reject leaks. ([Source](https://svelte.dev/docs/kit/server-only-modules/llms.txt)) ([Source](https://svelte.dev/docs/kit/$env-static-private))

### Package manager & runtime

- **RULE-BUN-001 — Bun is the only package manager (Stable).** All scripts and CI use `bun install`, `bun add`, `bun remove`, `bun run <script>`, `bun x <bin>`, `bun test`. `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` must not be committed; only `bun.lock` (text) is valid. ([Source](https://bun.com/docs/pm/lockfile)) ([Source](https://bun.com/package-manager))
- **RULE-BUN-002 — CI installs use `bun install --frozen-lockfile` (Stable).** Any divergence between `bun.lock` and `package.json` must fail the build. ([Source](https://bun.com/docs/pm/cli/remove)) ([Source](https://www.deployhq.com/guides/bun))
- **RULE-BUN-003 — Run dev/build through Bun explicitly (Stable).** Scripts: `"dev": "vite dev"`, `"build": "vite build"`, `"preview": "vite preview"`, invoked as `bun run dev` / `bun run build`. You may force the Bun JS runtime for Vite via `bun --bun run dev` when a perf benefit is measured, but SvelteKit's default Vite dev server is fully supported under Node-mode Bun. ([Source](https://bun.com/docs/guides/ecosystem/sveltekit)) ([Source](https://github.com/TheOtterlord/sveltekit-bun-template))
- **RULE-BUN-004 — Declare `trustedDependencies` for any package whose `postinstall` you require (Stable).** Bun does not execute lifecycle scripts of dependencies by default — list required ones in `package.json#trustedDependencies`. ([Source](https://docs.expo.dev/guides/using-bun/))

### Styling

- **RULE-UNO-001 — UnoCSS `presetWind4` is the only style engine (Stable).** Configuration lives in `uno.config.ts` at the project root. Add `UnoCSS()` before `sveltekit()` in `vite.config.ts`. Register `extractorSvelte` from `@unocss/extractor-svelte` so `class:foo={bar}` attributes are picked up. ([Source](https://unocss.dev/presets/wind4)) ([Source](http://www.unocss.cn/en/integrations/vite))
- **RULE-UNO-002 — Do not install any Tailwind CSS package (Stable / Reject substitute).** `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/postcss`, `tailwind.config.{js,ts}`, and `postcss.config.js` must not exist. Shadcn-svelte's CLI assumes Tailwind; see `RULE-SHADCN-002` and `RECIPE-SHADCN-INIT`. ([Source](https://unocss.dev/presets/wind4))
- **RULE-UNO-003 — Do not install a separate CSS reset under `presetWind4` (Stable).** `presetWind4` integrates a Tailwind-v4-aligned preflight. `@unocss/reset` and `normalize.css` are unnecessary and can conflict. ([Source](https://unocss.dev/presets/wind4))
- **RULE-SHADCN-001 — Add components with the current CLI (Stable).** `bunx shadcn-svelte@latest init` and `bunx shadcn-svelte@latest add <component>`. Components land under `src/lib/components/ui/<name>/` with an `index.ts` barrel. Import as `import * as Accordion from '$lib/components/ui/accordion'`. ([Source](https://www.shadcn-svelte.com/docs/cli)) ([Source](https://www.shadcn-svelte.com/docs/installation))
- **RULE-SHADCN-002 — Provide an empty `tailwind.config.js` and appropriate `components.json` so the shadcn-svelte CLI succeeds under UnoCSS (Conditional → Stable for this stack).** The CLI validates Tailwind config presence; `unocss-preset-shadcn` emits the CSS variables, and the empty config file is the documented workaround. ([Source](https://github.com/unocss-community/unocss-preset-shadcn)) ([Source](https://www.shadcn-svelte.com/docs/components-json))

### API client

- **RULE-OAPI-001 — Types are generated, never hand-written (Stable).** `openapi-typescript` v7+ consumes the Litestar spec (`/schema/openapi.json`) and emits `paths` and `components` types used by `openapi-fetch`. Never write domain DTOs by hand. ([Source](https://openapi-ts.dev/cli))
- **RULE-OAPI-002 — Use `openapi-fetch`'s typed `createClient<paths>()` (Stable).** Call with `client.GET('/path', { params: { path: { id } } })`. Always discriminate on `{ data, error }` rather than assuming success. ([Source](https://openapi-ts.dev/openapi-fetch/))
- **RULE-OAPI-003 — On the server, build the client with SvelteKit's `fetch` (Stable).** In load functions and actions, instantiate a request-scoped client passing `{ fetch: event.fetch }` so cookies/headers propagate. Never import a module-level client into server load functions that expects browser fetch semantics. ([Source](https://openapi-ts.dev/openapi-fetch/examples)) ([Source](https://svelte.dev/docs/kit/load))

### Security & configuration

- **RULE-SEC-001 — Leave SvelteKit's CSRF protections on (Stable).** Do not set `csrf.checkOrigin: false`. Configure `ORIGIN` at deploy time. For external trusted origins, add them to `kit.csrf.trustedOrigins`. ([Source](https://github.com/advisories/GHSA-5p75-vc5g-8rv2)) ([Source](https://gist.github.com/Maxiviper117/95a31750b74510bbb413d2e4ae20b4e8))
- **RULE-SEC-002 — Private env access is server-only (Stable).** Prefer `$env/static/private` over `$env/dynamic/private` to enable dead-code elimination; use `$env/dynamic/*` only when the value must change between build and runtime. ([Source](https://svelte.dev/docs/kit/$env-static-private))
- **RULE-SEC-003 — Session state is in HttpOnly cookies + `event.locals` (Stable).** Parse the session cookie in `hooks.server.ts` handle, populate `event.locals.user` / `event.locals.session`, and type them in `src/app.d.ts`'s `App.Locals`. Never store session state in module-level globals or `$state`. ([Source](https://joyofcode.xyz/sveltekit-authentication-using-cookies)) ([Source](https://github.com/sveltejs/kit/issues/12507))

## 5. Top Anti-Patterns

These are the highest-frequency AI-agent mistakes for this stack. Each must be rejected on sight.

- **ANTI-SVELTE4-001 — `$:` reactive labels in Svelte 5 code.** Replace with `$derived` (value) or `$effect` (side effect). ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- **ANTI-SVELTE4-002 — `export let foo` for props.** Replace with `let { foo } = $props()`. ([Source](https://svelte.dev/docs/svelte/$props))
- **ANTI-SVELTE4-003 — `on:click={...}` / `createEventDispatcher`.** Replace with `onclick={...}` and callback props. ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- **ANTI-SK1-001 — `throw error(...)` / `throw redirect(...)`.** Replace with `error(...)` / `redirect(...)`. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- **ANTI-SK1-002 — Reading `$page.data` from `$app/stores`.** Replace with `page.data` from `$app/state`. ([Source](https://svelte.dev/docs/kit/$app-state))
- **ANTI-PM-001 — `npm install`, `pnpm i`, `yarn add`, `npx <bin>` in this repo.** Replace with `bun install`, `bun add`, `bunx <bin>`. ([Source](https://bun.com/package-manager))
- **ANTI-TW-001 — Adding `tailwindcss` and `tailwind.config.js` content.** Replace with UnoCSS `presetWind4` + `uno.config.ts` (see `RULE-UNO-001`). ([Source](https://unocss.dev/presets/wind4))
- **ANTI-REACT-001 — Porting React/Next idioms (`useState`, `useEffect`, server components, `app/` router language, `'use client'`).** Replace with `$state`, `$derived`/`$effect`, SvelteKit `+page.server.ts`/`+page.ts` conventions. ([Source](https://svelte.dev/blog/runes))
- **ANTI-OAPI-LEGACY-001 — Using `openapi-typescript-fetch` or hand-written axios clients.** Replace with `openapi-fetch` (see `RULE-OAPI-002`). ([Source](https://openapi-ts.dev/openapi-fetch/))
- **ANTI-ADAPTER-001 — Leaving `@sveltejs/adapter-auto` / `adapter-node` in `svelte.config.js`.** Replace with `svelte-adapter-bun`. ([Source](https://www.npmjs.com/package/svelte-adapter-bun))

## 6. Decision Trees

- **DECIDE-RUNE-001 — Which rune?**
  - Need reactive component-local value → **use `$state`**.
  - Value computed from other reactive values → **use `$derived`** (or `$derived.by` when expression spans multiple statements).
  - Need component prop → **use `$props()`**. Need two-way binding on a prop → **add `$bindable()`** default.
  - Need side effect tied to lifecycle or state change (DOM, subscription, logging) → **use `$effect`**.
  - Need effect that runs *before* DOM flush → **use `$effect.pre`**.
  - Need to manage an effect outside a component's lifecycle (a singleton) → **use `$effect.root`**, and call its returned cleanup when destroying the singleton.
  - Debugging a proxy in logs → **use `$inspect` or `$state.snapshot`**.
  - Do **NOT** reach for `$effect` to implement a computed value — that's `$derived`. ([Source](https://svelte.dev/docs/svelte/$effect)) ([Source](https://svelte.dev/docs/svelte/$state))

- **DECIDE-LOAD-001 — Where does data loading belong?**
  - Touches DB, uses secrets, reads cookies, hits internal infra → **`+page.server.ts` / `+layout.server.ts`**.
  - Uses public-only API, benefits from client-side re-run on navigation → **`+page.ts` / `+layout.ts`**.
  - Needs the combination (server auth + client convenience) → **both files**, with `+page.ts` calling `await parent()` and reading `data` from its parent (`+page.server.ts`).
  - Shared across multiple pages → **lift to `+layout.server.ts`** (but don't rely on layout loads for authorization — see `ANTI-AUTHZ-LAYOUT-001`). ([Source](https://svelte.dev/docs/kit/load)) ([Source](https://scottspence.com/posts/passing-sveltekit-page-server-js-data-to-page-js))

- **DECIDE-STATE-001 — Where does state live?**
  - Single component → local `$state`.
  - Parent ↔ child, UI-only → `$props()` + `$bindable()` + `bind:`.
  - Cross-component, single user session, survives HMR → `.svelte.ts` module exporting a class or object-with-getters.
  - Per-request data from backend → `load` return → `let { data } = $props()`.
  - Per-user auth/session → `event.locals` (server), surfaced via `+layout.server.ts` return.
  - Survives reload or should affect SSR → URL search params or cookies, not in-memory state. ([Source](https://svelte.dev/docs/kit/state-management)) ([Source](https://joyofcode.xyz/how-to-share-state-in-svelte-5))

- **DECIDE-API-001 — Where do I call the backend?**
  - SSR-first data needed for render → **server load (`+page.server.ts`)** calling `openapi-fetch` client seeded with `event.fetch`.
  - Public API data that's fine on both sides and benefits from client-side refetch → **universal load (`+page.ts`)** using `openapi-fetch` client seeded with the load `fetch`.
  - Fire-and-forget user action from a form → **form action** (`+page.server.ts` `actions`), optionally delegating to the typed client internally.
  - Imperative client-side call in response to a UI event → **client-only module** importing `openapi-fetch` with browser `fetch`, invoked inside event handlers or `$effect`. Never during component initialization on a server-rendered page.

- **DECIDE-STYLE-001 — Where do styles go?**
  - Component-local visual state → UnoCSS utility classes on elements.
  - Repeating pattern within a component tree → `shortcuts` in `uno.config.ts` or a component wrapper.
  - Design-token change (colors, radius, fonts) → shadcn CSS variables emitted by `unocss-preset-shadcn` in the `:root` layer.
  - One-off scoped style that can't be expressed in utilities → `<style>` block in the `.svelte` file (scoped automatically).
  - Never use `@apply` to re-assemble utility classes — compose shortcuts instead. ([Source](https://unocss.dev/presets/wind4))

- **DECIDE-FORM-001 — How do I handle a mutation?**
  - Standard submit → SvelteKit form action + `use:enhance`.
  - Complex client validation with schemas → form action + Superforms (Conditional).
  - Non-form imperative call (e.g., optimistic button) → typed `openapi-fetch` call in an event handler, then `invalidate('app:something')` to rerun dependent loads. ([Source](https://svelte.dev/docs/kit/form-actions)) ([Source](https://svelte.dev/docs/kit/$app-navigation))

## 7. Canonical Project Structure

```
.
├── bunfig.toml
├── bun.lock
├── package.json
├── svelte.config.js
├── vite.config.ts
├── uno.config.ts
├── components.json                # shadcn-svelte CLI config
├── tailwind.config.js             # empty stub, required by shadcn CLI under UnoCSS
├── tsconfig.json
├── openapi/
│   └── openapi.json               # fetched from Litestar /schema/openapi.json
├── scripts/
│   └── gen-api.ts                 # wraps openapi-typescript
└── src/
    ├── app.html
    ├── app.css                    # global reset hooks & shadcn vars
    ├── app.d.ts                   # declares App.Locals, App.PageData, App.Error
    ├── hooks.server.ts
    ├── hooks.client.ts            # optional
    ├── lib/
    │   ├── components/
    │   │   └── ui/                # shadcn-svelte generated components
    │   ├── api/
    │   │   ├── schema.d.ts        # generated by openapi-typescript
    │   │   ├── client.ts          # browser/universal client factory
    │   │   └── server.ts          # server-only factory (takes event.fetch)
    │   ├── server/                # server-only modules (DB, auth, secrets)
    │   │   ├── db.ts
    │   │   └── session.ts
    │   ├── state/
    │   │   └── auth.svelte.ts     # shared reactive stores (runes)
    │   └── utils.ts               # cn() helper for shadcn
    └── routes/
        ├── +layout.svelte
        ├── +layout.server.ts
        ├── +page.svelte
        ├── +page.server.ts
        ├── +error.svelte
        └── (app)/
            └── users/
                ├── +page.svelte
                ├── +page.server.ts
                └── [id]/
                    ├── +page.svelte
                    └── +page.server.ts
```

Rules:

- **Server-only**: anything reachable only via imports from `src/lib/server/**` or files ending in `.server.ts`. Client code importing them is a compile-time error. ([Source](https://svelte.dev/docs/kit/server-only-modules/llms.txt))
- **Generated artifacts** (`src/lib/api/schema.d.ts`) are committed but never hand-edited.
- **Tests**: co-locate as `*.svelte.test.ts` (browser, runes) and `*.test.ts` (node, pure functions). E2E in `tests/` with Playwright.

## 8. Layer Guidelines

| Layer | Default (Stable) | Main thing to avoid | Related IDs |
|---|---|---|---|
| Component (`.svelte`) | Runes, lowercase event props, snippets, UnoCSS utilities | Svelte 4 reactivity, `on:`, `<slot>`, `@apply` | `RULE-RUNES-001` `RULE-EVENTS-001` `RULE-SNIPPETS-001` `ANTI-SVELTE4-*` `ANTI-TW-001` |
| Shared state (`.svelte.ts`) | Exported class or object w/ getters | Exporting primitive `$state` | `RULE-RUNES-003` `PATTERN-STATE-001` |
| Routes (`+page.*`) | Split server vs. universal by data sensitivity | Putting secrets in `+page.ts` | `RULE-SK-FILES-001` `DECIDE-LOAD-001` |
| Hooks (`hooks.server.ts`) | Populate `event.locals`; use `sequence()` to compose | Running authorization solely in `+layout.server.ts` | `RULE-SEC-003` `ANTI-AUTHZ-LAYOUT-001` |
| Forms | Form actions + `use:enhance` | Client-only JSON POSTs that bypass CSRF | `RULE-SK-FORMS-001` `RULE-SEC-001` |
| API | Generated types + `openapi-fetch` | Hand-written DTOs, raw `fetch` with `any` | `RULE-OAPI-*` `PATTERN-OAPI-*` |
| Styling | UnoCSS utilities, shadcn components, tokens via CSS vars | Tailwind config files, `@apply` | `RULE-UNO-*` `RULE-SHADCN-*` |
| Build/deploy | `svelte-adapter-bun`, `bun ./build/index.js` | `adapter-auto`, `adapter-node` for this stack | `ANTI-ADAPTER-001` `RECIPE-DEPLOY-BUN` |
| Tests | `vitest` with multi-project (browser + node) or `bun test` for pure TS | Jest, `@testing-library/svelte` with jsdom for Svelte 5 | `VERIFY-TEST-001` |

## 9. Cross-Cutting Architecture

- **Boundaries.** Browser ⇄ SvelteKit server ⇄ Litestar API. The SvelteKit server is a **trusted intermediary**: it holds secrets (in `$env/static/private`), reads HttpOnly cookies, and talks to Litestar over HTTP. The browser talks only to SvelteKit (either the SvelteKit server or public endpoints re-exposed from it).
- **Data flow (read).** `hooks.server.ts` populates `event.locals` → `+*.server.ts` `load` uses `event.locals` + generated API client (seeded with `event.fetch`) → returned data → `+page.svelte` `let { data } = $props()`.
- **Data flow (write).** `<form method="POST" use:enhance>` → `+page.server.ts` `actions` → validate → call typed API client → `return { ok: true, form }` or `fail(400, { ... })` → SvelteKit rerenders with `form` prop.
- **Error flow.** Load/action calls `error(status, 'msg')` for expected, user-visible errors; unexpected exceptions are caught by `handleError` in `hooks.server.ts` and surface to `+error.svelte`. Never rely on `try/catch` to re-throw `redirect(...)` — call redirects outside `try`. ([Source](https://github.com/sveltejs/kit/issues/8689))
- **Validation.** Validate on the server (form actions, server load). Optimistic client-side validation is decoration only.
- **Type flow.** `openapi-typescript` reads Litestar's OpenAPI → `schema.d.ts`; every client call is typed from that. No duplicated TypeScript types for API payloads.
- **Dependency direction.** UI → shared state (`$lib/state`) → API client (`$lib/api`) → external. Never the reverse. Server-only modules may not be imported by client code; the compiler enforces this.
- **Configuration.** `svelte.config.js` picks `svelte-adapter-bun`. `vite.config.ts` wires UnoCSS before SvelteKit. `uno.config.ts` owns theme + presets. `bunfig.toml` owns Bun settings (registry, install behavior).
- **Observability.** Log server-side errors in `handleError` (include status + route). Stream non-critical data via nested promises in server load to improve TTFB. ([Source](https://svelte.dev/docs/kit/load))
- **Security.** Keep CSRF on. All mutations are form actions or fetch-with-cookie requests against same origin. Set `ORIGIN` in deployment env. ([Source](https://github.com/advisories/GHSA-5p75-vc5g-8rv2))
- **Performance.** Prefer `$derived` over `$effect`. Colocate reactive reads (signals fire per-property). Use `$state.raw` for large arrays or objects where fine-grained reactivity isn't needed. ([Source](https://svelte.dev/docs/svelte/$state))
- **Testing.** Unit (pure TS, `bun test` or `vitest` node project), component (`vitest-browser-svelte` + Playwright provider), E2E (Playwright). No jsdom for Svelte 5 component tests. ([Source](https://scottspence.com/posts/testing-with-vitest-browser-svelte-guide))
- **Migration posture.** When opening a file that still contains Svelte 4 or SvelteKit 1 idioms in modified scope, refactor those local symbols toward the rules. Don't silently rewrite the whole file; announce to the user.

## 10. Canonical Patterns

### PATTERN-STATE-001 — Local reactive state & props (Stable)

```svelte
<!-- src/lib/components/Counter.svelte -->
<script lang="ts">
  type Props = { initial?: number; onchange?: (n: number) => void };
  let { initial = 0, onchange }: Props = $props();

  let count = $state(initial);
  let doubled = $derived(count * 2);

  function inc() {
    count += 1;
    onchange?.(count);
  }
</script>

<button onclick={inc}>{count} (×2 = {doubled})</button>
```

### PATTERN-STATE-002 — Shared reactive state in `.svelte.ts` (Stable)

```ts
// src/lib/state/counter.svelte.ts
class Counter {
  value = $state(0);
  get doubled() { return this.value * 2; }
  increment() { this.value += 1; }
}
export const counter = new Counter();
```

```svelte
<!-- src/lib/components/CounterView.svelte -->
<script lang="ts">
  import { counter } from '$lib/state/counter.svelte';
</script>

<button onclick={() => counter.increment()}>{counter.value}</button>
```

Do not `export const count = $state(0)` — consumers would receive a non-reactive copy. ([Source](https://joyofcode.xyz/how-to-share-state-in-svelte-5))

### PATTERN-SNIPPET-001 — Snippets & children (Stable)

```svelte
<!-- src/lib/components/Card.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children, footer }: {
    title: string;
    children: Snippet;
    footer?: Snippet;
  } = $props();
</script>

<article class="rounded-lg border p-4">
  <h2 class="font-semibold">{title}</h2>
  {@render children()}
  {#if footer}<footer class="mt-4 text-sm opacity-70">{@render footer()}</footer>{/if}
</article>
```

### PATTERN-LOAD-001 — Server load with typed API client (Stable)

```ts
// src/routes/users/+page.server.ts
import { error } from '@sveltejs/kit';
import { makeServerClient } from '$lib/api/server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const api = makeServerClient(event);
  const { data, error: apiError, response } = await api.GET('/users', {
    params: { query: { limit: 20 } }
  });
  if (apiError) error(response.status, apiError.detail ?? 'Failed to load users');
  return { users: data.items };
};
```

### PATTERN-LOAD-002 — Universal load with provided fetch (Stable)

```ts
// src/routes/public-stats/+page.ts
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('app:public-stats');
  const res = await fetch('/api/public/stats'); // relative OK on server & client
  if (!res.ok) throw new Error('stats failed');
  return { stats: await res.json() as { views: number } };
};
```

### PATTERN-FORM-001 — Form action + progressive enhancement (Stable)

```ts
// src/routes/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    if (!email || !password) return fail(400, { email, error: 'Missing fields' });

    const session = await locals.auth.signIn(email, password);
    if (!session) return fail(401, { email, error: 'Invalid credentials' });

    cookies.set('session', session.token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 7
    });
    redirect(303, '/');
  }
};
```

```svelte
<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  let { form } = $props();
</script>

<form method="POST" use:enhance>
  <input name="email" type="email" value={form?.email ?? ''} required />
  <input name="password" type="password" required />
  {#if form?.error}<p class="text-red-600">{form.error}</p>{/if}
  <button>Sign in</button>
</form>
```

### PATTERN-HOOKS-001 — Auth enrichment via `hooks.server.ts` (Stable)

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session') ?? null;
  const ctx = token ? await validateSession(token) : null;
  event.locals.user = ctx?.user ?? null;
  event.locals.session = ctx?.session ?? null;
  return resolve(event);
};
```

```ts
// src/app.d.ts
import type { User, Session } from '$lib/server/session';
declare global {
  namespace App {
    interface Locals { user: User | null; session: Session | null; }
    interface PageData { user?: User | null }
    interface Error { message: string; code?: string }
  }
}
export {};
```

### PATTERN-OAPI-001 — Server-side typed client (Stable)

```ts
// src/lib/api/server.ts
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import { API_BASE_URL } from '$env/static/private';
import type { RequestEvent } from '@sveltejs/kit';

export function makeServerClient(event: RequestEvent) {
  const client = createClient<paths>({
    baseUrl: API_BASE_URL,
    fetch: event.fetch
  });

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = event.locals.session?.token;
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    }
  };
  client.use(auth);
  return client;
}
```

### PATTERN-OAPI-002 — Browser-side typed client (Stable)

```ts
// src/lib/api/client.ts
import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { PUBLIC_API_BASE_URL } from '$env/static/public';

export const api = createClient<paths>({ baseUrl: PUBLIC_API_BASE_URL });
```

### PATTERN-UNO-001 — `uno.config.ts` with `presetWind4` + shadcn (Stable)

```ts
// uno.config.ts
import { defineConfig } from 'unocss';
import presetWind4 from '@unocss/preset-wind4';
import extractorSvelte from '@unocss/extractor-svelte';
import presetAnimations from 'unocss-preset-animations';
import { presetShadcn } from 'unocss-preset-shadcn';
import transformerDirectives from '@unocss/transformer-directives';
import transformerVariantGroup from '@unocss/transformer-variant-group';

export default defineConfig({
  extractors: [extractorSvelte()],
  presets: [
    presetWind4(),
    presetAnimations(),
    presetShadcn({ color: 'zinc' })
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  content: {
    filesystem: ['src/**/*.{svelte,ts,tsx,js,jsx,html}']
  }
});
```

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [UnoCSS(), sveltekit()]
});
```

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import 'virtual:uno.css';
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

### PATTERN-ADAPTER-001 — `svelte.config.js` with Bun adapter (Stable)

```js
// svelte.config.js
import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: { brotli: true, gzip: true, files: ['html', 'js', 'css', 'svg', 'xml'] }
    }),
    csrf: { checkOrigin: true }
  }
};
```

## 11. Canonical Recipes

### RECIPE-OAPI-CLIENT — Regenerate types & wire the typed API client

**Purpose.** Keep the frontend in lock-step with the Litestar OpenAPI spec.
**When to use.** Any time the backend spec changes or a new endpoint is added.
**Files changed.** `openapi/openapi.json` (fetched), `src/lib/api/schema.d.ts` (generated), `scripts/gen-api.ts`, `package.json` scripts.

```ts
// scripts/gen-api.ts
import { writeFile } from 'node:fs/promises';

const SPEC_URL = process.env.OPENAPI_URL ?? 'http://localhost:8000/schema/openapi.json';
const res = await fetch(SPEC_URL);
if (!res.ok) throw new Error(`Spec fetch failed: ${res.status}`);
await writeFile('openapi/openapi.json', await res.text());
console.log('Fetched spec →', SPEC_URL);
```

```json
// package.json (scripts excerpt)
{
  "scripts": {
    "api:fetch": "bun run scripts/gen-api.ts",
    "api:gen": "bunx openapi-typescript openapi/openapi.json -o src/lib/api/schema.d.ts",
    "api:sync": "bun run api:fetch && bun run api:gen"
  }
}
```

Verification:

```sh
bun run api:sync
bun run check            # should succeed with the new types
```

The CLI invocation, `--output` flag, and input URL support are documented in `openapi-typescript` v7. ([Source](https://openapi-ts.dev/cli))

### RECIPE-SHADCN-INIT — Scaffold shadcn-svelte under UnoCSS

**Purpose.** Install the shadcn-svelte CLI in a UnoCSS project without adopting Tailwind.
**When to use.** New project bootstrap.
**Files changed.** `components.json`, empty `tailwind.config.js`, `src/app.css`, `src/lib/utils.ts`, `uno.config.ts`.

```sh
# one-time CLI bootstrap (uses the latest shadcn-svelte CLI)
bunx shadcn-svelte@latest init
bunx shadcn-svelte@latest add button card dialog
```

```json
// components.json
{
  "$schema": "https://shadcn-svelte.com/schema.json",
  "style": "new-york",
  "tailwind": { "config": "tailwind.config.js", "css": "src/app.css", "baseColor": "zinc" },
  "aliases": { "components": "$lib/components", "utils": "$lib/utils", "ui": "$lib/components/ui", "hooks": "$lib/hooks", "lib": "$lib" }
}
```

```js
// tailwind.config.js — intentional stub so shadcn-svelte CLI succeeds under UnoCSS
export default { content: [] };
```

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

Verification: start the dev server, render a `Button` component, confirm the theme tokens (background / foreground / primary) resolve to the `presetShadcn` palette. ([Source](https://github.com/unocss-community/unocss-preset-shadcn)) ([Source](https://www.shadcn-svelte.com/docs/components-json))

### RECIPE-DEPLOY-BUN — Build & run via `svelte-adapter-bun`

**Purpose.** Produce a standalone Bun server for production.
**When to use.** Every deployment.
**Files changed.** `svelte.config.js`, `Dockerfile` (if applicable).

```sh
bun install --frozen-lockfile
bun run build
PORT=3000 ORIGIN=https://example.com bun ./build/index.js
```

```dockerfile
# Dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["bun", "./build/index.js"]
```

Set `ORIGIN` to the public HTTPS origin; otherwise SvelteKit's CSRF protection will reject cross-origin form submissions. ([Source](https://www.programonaut.com/cross-site-post-form-submissions-are-forbidden-in-sveltekit/)) ([Source](https://www.npmjs.com/package/svelte-adapter-bun))

### RECIPE-SERVER-WRITE — Optimistic form submit + invalidation

**Purpose.** Mutate data and reflect it without a hard reload.
**When to use.** Any list page with add/remove operations.

```svelte
<!-- src/routes/todos/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidate } from '$app/navigation';
  let { data, form } = $props();
</script>

<form method="POST" action="?/add" use:enhance={() => {
  return async ({ update }) => { await update(); await invalidate('app:todos'); };
}}>
  <input name="title" required />
  <button>Add</button>
</form>

<ul>{#each data.todos as t (t.id)}<li>{t.title}</li>{/each}</ul>
```

```ts
// src/routes/todos/+page.server.ts
import { fail } from '@sveltejs/kit';
import { makeServerClient } from '$lib/api/server';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  event.depends('app:todos');
  const api = makeServerClient(event);
  const { data } = await api.GET('/todos');
  return { todos: data?.items ?? [] };
};

export const actions: Actions = {
  add: async (event) => {
    const form = await event.request.formData();
    const title = String(form.get('title') ?? '').trim();
    if (!title) return fail(400, { error: 'Title required' });

    const api = makeServerClient(event);
    const { error } = await api.POST('/todos', { body: { title } });
    if (error) return fail(502, { error: 'Upstream error' });
    return { ok: true };
  }
};
```

## 12. Full Anti-Pattern Ledger

### Svelte 5 drift from Svelte 4

- **ANTI-SVELTE4-001 — `$:` reactive statements.** Forbidden in runes mode. Replace with `$derived` (value) or `$effect` (side effect). Existing code: convert in place on touch. ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- **ANTI-SVELTE4-002 — `export let` props.** Replace with `let { foo, bar = $bindable() } = $props()`. ([Source](https://svelte.dev/docs/svelte/$props))
- **ANTI-SVELTE4-003 — `on:click` / event modifiers (`|preventDefault`).** Replace with `onclick={handler}`; call `event.preventDefault()` inside the handler. ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- **ANTI-SVELTE4-004 — `createEventDispatcher`.** Replace with callback props (`onchange`, `onselect`). ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- **ANTI-SVELTE4-005 — `<slot>` / `<slot name="foo">`.** Replace with `{@render children()}` and snippet props. ([Source](https://svelte.dev/docs/svelte/@render))
- **ANTI-SVELTE4-006 — `writable`/`readable` stores as the default shared-state mechanism.** Replace with `$state` classes/objects in `.svelte.ts`. Stores remain valid for third-party interop only. ([Source](https://joyofcode.xyz/how-to-share-state-in-svelte-5))
- **ANTI-EFFECT-001 — Using `$effect` to compute a value.** Infinite-loop and SSR hazards. Replace with `$derived`. ([Source](https://github.com/sveltejs/svelte/issues/10193))
- **ANTI-EFFECT-002 — Mutating `$state` inside `$effect` without `untrack`.** Causes rerun loops. Replace with `$derived` or wrap the mutation in `untrack(() => ...)`. ([Source](https://svelte.dev/docs/svelte/$effect))

### SvelteKit 1 drift

- **ANTI-SK1-001 — `throw error(...)` / `throw redirect(...)`.** In SK2 just call them. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- **ANTI-SK1-002 — `$page` from `$app/stores`.** Replace with `page` from `$app/state` (SK ≥ 2.12, Svelte 5). ([Source](https://svelte.dev/docs/kit/$app-state))
- **ANTI-SK1-003 — Relying on automatic top-level promise awaiting in `load`.** In SK2 top-level promises are no longer auto-awaited; add `await` or `Promise.all`. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- **ANTI-SK1-004 — `resolvePath` from `@sveltejs/kit`.** Replaced by `resolveRoute` from `$app/paths` (includes base). ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- **ANTI-SK1-005 — `preloadCode('/a', '/b')` variadic form.** Takes a single argument in SK2, and the path must include `base`. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- **ANTI-SK1-006 — `dangerZone.trackServerFetches`.** Removed in SK2; delete it. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- **ANTI-SK1-007 — Global `fetch` inside load functions.** Use the `fetch` argument. Global fetch cannot resolve relative URLs on the server and loses cookies. ([Source](https://svelte.dev/docs/kit/load))
- **ANTI-AUTHZ-LAYOUT-001 — Placing authorization logic in `+layout.server.ts`.** Layout loads don't reliably re-run on every child; enforce auth in `hooks.server.ts` `handle` or in each `+page.server.ts`. ([Source](https://authjs.dev/reference/sveltekit))

### Adjacent ecosystem drift

- **ANTI-REACT-001 — React idioms (`useState`, `useEffect`, `useMemo`, `'use client'`, `app/` router terminology, server components).** None apply. Use runes + SvelteKit file conventions. ([Source](https://svelte.dev/blog/runes))
- **ANTI-NEXT-001 — `next/link`, `next/image`, `@vercel/og` for OG images.** Use SvelteKit `<a href>` (auto-enhanced), standard `<img>` tags, and SvelteKit-native OG solutions.
- **ANTI-TW-001 — Installing `tailwindcss` and writing `tailwind.config.js`.** Replace with UnoCSS `presetWind4`. A *stub* `tailwind.config.js` is allowed only to satisfy the shadcn-svelte CLI (see `RULE-SHADCN-002`). ([Source](https://unocss.dev/presets/wind4))
- **ANTI-TW-002 — `@apply` in component `<style>` blocks.** Not portable across UnoCSS modes. Use shortcuts in `uno.config.ts` (`shortcuts: { 'btn-primary': 'px-4 py-2 rounded bg-primary text-primary-foreground' }`). ([Source](https://unocss.dev/presets/wind4))
- **ANTI-RESET-001 — Importing `@unocss/reset/*` alongside `presetWind4`.** The preset ships its own preflight. Remove the extra reset. ([Source](https://unocss.dev/presets/wind4))

### Package manager & runtime

- **ANTI-PM-001 — `npm`, `pnpm`, `yarn` commands or lockfiles.** Replace with Bun commands; delete other lockfiles. ([Source](https://bun.com/package-manager))
- **ANTI-PM-002 — `npx <bin>`.** Replace with `bunx <bin>`. ([Source](https://bun.com/))
- **ANTI-LOCK-001 — Committing `bun.lockb` in new repos.** Bun ≥ 1.2 uses text-based `bun.lock`; migrate with `bun install --save-text-lockfile --frozen-lockfile --lockfile-only` and delete `bun.lockb`. ([Source](https://bun.com/docs/pm/lockfile))
- **ANTI-ADAPTER-001 — `@sveltejs/adapter-auto` or `adapter-node` in `svelte.config.js`.** Replace with `svelte-adapter-bun`. ([Source](https://www.npmjs.com/package/svelte-adapter-bun))

### API client

- **ANTI-OAPI-LEGACY-001 — `openapi-typescript-fetch`.** Replace with `openapi-fetch` + `openapi-typescript` v7. ([Source](https://openapi-ts.dev/openapi-fetch/))
- **ANTI-OAPI-LEGACY-002 — Hand-written TypeScript types for API DTOs.** Replace with generated `components['schemas']['X']`. ([Source](https://openapi-ts.dev/cli))
- **ANTI-OAPI-V6 — Using openapi-typescript v6 flags (`--export-type`, globs) in v7.** v7 reorganizes CLI around `redocly.yaml` and drops the glob semantic. ([Source](https://github.com/openapi-ts/openapi-typescript/issues/1368))

### Security

- **ANTI-SEC-001 — `csrf: { checkOrigin: false }` in production.** Never. If you need to allow trusted origins, use `csrf.trustedOrigins`. ([Source](https://github.com/advisories/GHSA-5p75-vc5g-8rv2))
- **ANTI-SEC-002 — Storing secrets in `$env/static/public` / `$env/dynamic/public`.** `PUBLIC_*` is exposed to browsers. Only put non-sensitive values there. ([Source](https://svelte.dev/docs/kit/$env-static-private))
- **ANTI-SEC-003 — Module-level `$state` holding per-user data on the server.** Leaks across requests. Use `event.locals` + cookies. ([Source](https://github.com/sveltejs/kit/issues/12507))

## 13. Testing, Verification & Tooling

- **VERIFY-SYNC-001 — Regenerate framework types.** `bunx svelte-kit sync`. Run after adding routes, changing `svelte.config.js`, or pulling dependency updates. ([Source](https://svelte.dev/docs/kit/@sveltejs-kit))
- **VERIFY-CHECK-001 — Type + Svelte check.**
  ```sh
  bunx svelte-kit sync && bunx svelte-check --tsconfig ./tsconfig.json
  ```
  Exposed as `"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"` and run as `bun run check`. Must be green before merging. ([Source](https://socket.dev/npm/package/svelte-check/overview/1.2.5))
- **VERIFY-LINT-001 — ESLint + Prettier.** `bun run lint` runs `prettier --check .` + `eslint .`; `bun run format` writes Prettier. Use `eslint-plugin-svelte` v3 with ESLint flat config (`eslint.config.js`). ([Source](https://sveltejs.github.io/eslint-plugin-svelte/migration/))
- **VERIFY-BUILD-001 — Production build.** `bun run build`. Confirms `svelte-adapter-bun` emits `build/index.js`. ([Source](https://www.npmjs.com/package/svelte-adapter-bun))
- **VERIFY-RUN-001 — Smoke run.** `ORIGIN=http://localhost:3000 bun ./build/index.js`; expect a 200 on `/` and correct form action behavior. ([Source](https://www.npmjs.com/package/svelte-adapter-bun))
- **VERIFY-API-001 — Regenerate API types.** `bun run api:sync` (see `RECIPE-OAPI-CLIENT`). Follow with `bun run check`. ([Source](https://openapi-ts.dev/cli))
- **VERIFY-TEST-001 — Tests.**
  - Pure TS modules (no DOM, no Svelte compiler): `bun test src/lib/**/*.test.ts`. `bun:test` is Jest-compatible and first-class in Bun. ([Source](https://bun.com/))
  - Svelte 5 components: Vitest Browser mode with `vitest-browser-svelte` + Playwright provider:
    ```sh
    bun run test          # vitest run
    bun run test:watch    # vitest
    ```
    Configure `vite.config.ts` / `vitest.config.ts` with the `@vitest/browser-playwright` provider; include `src/**/*.svelte.test.ts` for client tests. jsdom is **not** acceptable for Svelte 5 component tests. ([Source](https://scottspence.com/posts/testing-with-vitest-browser-svelte-guide)) ([Source](https://sveltest.dev/docs/getting-started))
- **VERIFY-LOCK-001 — Install must not modify lockfile in CI.** `bun install --frozen-lockfile` — failing build on drift is the intended behavior. ([Source](https://bun.com/docs/pm/cli/remove))

## 14. Migration & Upgrade Notes (only what affects code you touch today)

### Svelte 4 → Svelte 5

- Run `bunx sv migrate svelte-5` for a mechanical first pass; then review by hand. ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))
- Replace `let foo = 0` (reactive) with `let foo = $state(0)`.
- Replace `$: doubled = foo * 2` with `let doubled = $derived(foo * 2)`.
- Replace `$: { ...side-effect... }` with `$effect(() => { ... })` — reconsider whether `$derived` is actually what you want.
- Replace `export let name = 'x'` with `let { name = 'x' } = $props()`.
- Replace `on:click={fn}` with `onclick={fn}`. Replace event modifiers (`|preventDefault`) with in-handler `event.preventDefault()`.
- Replace `<slot>` / `<slot name="header" />` with `{@render children()}` and snippet props.
- Replace `createEventDispatcher` with callback props (`onsubmit`, `onchange`, …). ([Source](https://svelte.dev/docs/svelte/v5-migration-guide))

### SvelteKit 1 → SvelteKit 2

- `bunx sv migrate sveltekit-2` handles most mechanical changes. ([Source](https://svelte.dev/docs/kit/migrating-to-sveltekit-2))
- `throw error(...)` / `throw redirect(...)` → `error(...)` / `redirect(...)`.
- Add `await` to top-level promises in `load` returns that should block rendering; use `Promise.all` to parallelize.
- `resolvePath` → `resolveRoute` (from `$app/paths`; includes `base`).
- `preloadCode('/a', '/b', ...)` → `preloadCode('/a')` (single arg, with `base` prefix).
- Remove `dangerZone.trackServerFetches`.
- On ≥ 2.12 + Svelte 5: migrate `$app/stores` → `$app/state`.

### UnoCSS presetWind3 → presetWind4

- Install `@unocss/preset-wind4`; update `uno.config.ts` presets list.
- Remove any `@unocss/reset/*` imports (presetWind4 ships its preflight).
- Review theme keys — presetWind4 adjusted some from presetWind3; the migration table is in the UnoCSS docs. ([Source](https://unocss.dev/presets/wind4))

### shadcn-svelte (legacy Svelte 4 CLI) → shadcn-svelte 1.x

- Old CLI is `npx shadcn-svelte@legacy` and uses Svelte 4 components. Current CLI is `bunx shadcn-svelte@latest`. ([Source](https://www.shadcn-svelte.com/docs/migration))
- Add `data-slot` attributes (the current component style uses them for styling hooks). Re-add components via the CLI to pick up the new defaults. ([Source](https://www.shadcn-svelte.com/docs/migration/tailwind-v4))

### openapi-typescript v6 → v7

- v7 uses the TypeScript AST (fewer serialization bugs) and adds Redocly-based validation and a `redocly.yaml` config route. Flag set is narrowed; glob inputs are replaced by `redocly.yaml` entries. ([Source](https://github.com/openapi-ts/openapi-typescript/issues/1368))

### Bun lockfile

- Migrate `bun.lockb` to text-based `bun.lock` once with `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`, delete `bun.lockb`, commit both changes together. ([Source](https://bun.com/docs/pm/lockfile))

## 15. Source Ledger

- **SOURCE-SVELTE-RUNES** — *"Introducing runes"*, Svelte blog. <https://svelte.dev/blog/runes>. Researched 2026-04-24. Supports: runes rationale, `$state`/`$derived`/`$effect` semantics.
- **SOURCE-SVELTE-V5-MIGRATION** — *"Svelte 5 migration guide"*, Svelte Docs. <https://svelte.dev/docs/svelte/v5-migration-guide>. Supports: Svelte 4 → 5 replacements, events, props, slots.
- **SOURCE-SVELTE-STATE** — *"$state"*, Svelte Docs. <https://svelte.dev/docs/svelte/$state>. Supports: deep reactivity, proxies, `$state.raw`, `$state.snapshot`.
- **SOURCE-SVELTE-EFFECT** — *"$effect"*, Svelte Docs. <https://svelte.dev/docs/svelte/$effect>. Supports: don't-use-effect-for-values, `$effect.pre`, `$effect.root`.
- **SOURCE-SVELTE-PROPS** — *"$props"*, Svelte Docs. <https://svelte.dev/docs/svelte/$props>. Supports: `$bindable`, `$props.id`.
- **SOURCE-SVELTE-RENDER** — *"{@render ...}"*, Svelte Docs. <https://svelte.dev/docs/svelte/@render>. Supports: snippets replacing slots.
- **SOURCE-SK-MIG** — *"Migrating to SvelteKit 2"*, SvelteKit Docs. <https://svelte.dev/docs/kit/migrating-to-sveltekit-2>. Supports: SK2 breaking changes (error/redirect, top-level promises, resolveRoute, preloadCode).
- **SOURCE-SK-LOAD** — *"Loading data"*, SvelteKit Docs. <https://svelte.dev/docs/kit/load>. Supports: load rules, `fetch` arg, streaming promises, concurrency.
- **SOURCE-SK-APPSTATE** — *"$app/state"*, SvelteKit Docs. <https://svelte.dev/docs/kit/$app-state>. Supports: `page`, `navigating`, `updated` as runes-based state.
- **SOURCE-SK-APPSTORES** — *"$app/stores"*, SvelteKit Docs (llms.txt). <https://svelte.dev/docs/kit/$app-stores/llms.txt>. Supports: deprecation of `$app/stores` in Svelte 5.
- **SOURCE-SK-STATEMGMT** — *"State management"*, SvelteKit Docs. <https://svelte.dev/docs/kit/state-management>. Supports: server-side `$state` leak warning.
- **SOURCE-SK-SERVERONLY** — *"Server-only modules"*, SvelteKit Docs (llms.txt). <https://svelte.dev/docs/kit/server-only-modules/llms.txt>. Supports: `$lib/server/**` and `.server.ts` enforcement.
- **SOURCE-SK-ENV** — *"$env/static/private"*, SvelteKit Docs. <https://svelte.dev/docs/kit/$env-static-private>. Supports: static vs dynamic env, build-time optimization.
- **SOURCE-SK-CSRF-GHSA-5p75** — *"Insufficient CSRF Protection"*, GitHub Advisory. <https://github.com/advisories/GHSA-5p75-vc5g-8rv2>. Supports: CSRF posture guidance.
- **SOURCE-SK-REDIRECT-CATCH** — *"Clarify and Document use of 'throw redirect()' in try-catch block"*, sveltejs/kit #8689. <https://github.com/sveltejs/kit/issues/8689>. Supports: redirect-inside-try-catch hazard.
- **SOURCE-SK-RUNE-SSR** — *"Svelte 5: Rune is not stateless in SSR"*, sveltejs/kit #12507. <https://github.com/sveltejs/kit/issues/12507>. Supports: module-level `$state` leaks between requests on server.
- **SOURCE-SK-AUTHZ** — *"Auth.js | SvelteKit"*, Auth.js Docs. <https://authjs.dev/reference/sveltekit>. Supports: "do not authorize in `+layout.server.ts`" warning.
- **SOURCE-SK-NAV** — *"$app/navigation"*, SvelteKit Docs. <https://svelte.dev/docs/kit/$app-navigation>. Supports: `goto`, `invalidate`, `invalidateAll` semantics.
- **SOURCE-BUN-HOME** — Bun homepage. <https://bun.com/>. Supports: current stable Bun version, toolkit scope.
- **SOURCE-BUN-PM** — *"bun install — Superfast Node.js-compatible package manager"*. <https://bun.com/package-manager>. Supports: bun install/add workspaces.
- **SOURCE-BUN-LOCKFILE** — *"Lockfile"*, Bun Docs. <https://bun.com/docs/pm/lockfile>. Supports: text lockfile default since 1.2, migration command.
- **SOURCE-BUN-CLI-REMOVE** — *"bun remove"*, Bun Docs. <https://bun.com/docs/pm/cli/remove>. Supports: `--frozen-lockfile`, CLI flag taxonomy shared across install/remove.
- **SOURCE-BUN-SK-GUIDE** — *"Build an app with SvelteKit and Bun"*, Bun Docs. <https://bun.com/docs/guides/ecosystem/sveltekit>. Supports: recommended adapter (`svelte-adapter-bun`), dev server pattern.
- **SOURCE-BUN-TRUSTED** — *"Using Bun"*, Expo Docs. <https://docs.expo.dev/guides/using-bun/>. Supports: `trustedDependencies` requirement for postinstall scripts.
- **SOURCE-ADAPTER-BUN** — *"svelte-adapter-bun"* on npm. <https://www.npmjs.com/package/svelte-adapter-bun>. Supports: adapter options, env conventions, ORIGIN handling.
- **SOURCE-UNO-WIND4** — *"Wind4 preset"*, UnoCSS Docs. <https://unocss.dev/presets/wind4>. Supports: Tailwind v4 compat, bundled preflight, theme keys.
- **SOURCE-UNO-VITE** — *"UnoCSS Vite Plugin"*. <http://www.unocss.cn/en/integrations/vite>. Supports: plugin ordering, `extractorSvelte` setup.
- **SOURCE-UNO-SHADCN** — *"unocss-preset-shadcn"* on GitHub. <https://github.com/unocss-community/unocss-preset-shadcn>. Supports: presetShadcn API, v1 default on presetWind4, `tailwind.config.js` stub workaround.
- **SOURCE-SHADCN-INSTALL** — *"Manual Installation"*, shadcn-svelte Docs. <https://www.shadcn-svelte.com/docs/installation/manual>. Supports: sv CLI + dependencies + `$lib` alias conventions.
- **SOURCE-SHADCN-CLI** — *"CLI"*, shadcn-svelte Docs. <https://www.shadcn-svelte.com/docs/cli>. Supports: `init`, `add`, and `registry build` commands.
- **SOURCE-SHADCN-CJSON** — *"components.json"*, shadcn-svelte Docs. <https://www.shadcn-svelte.com/docs/components-json>. Supports: schema, aliases, `tailwind.config`/`css` fields.
- **SOURCE-SHADCN-MIG-TW4** — *"Tailwind v4"*, shadcn-svelte Docs. <https://www.shadcn-svelte.com/docs/migration/tailwind-v4>. Supports: data-slot attributes, deprecations.
- **SOURCE-SHADCN-CHANGELOG** — *"Changelog"*, shadcn-svelte. <https://www.shadcn-svelte.com/docs/changelog>. Supports: release timeline of TW v4 / Svelte 5 support.
- **SOURCE-SHADCN-NPM** — *"shadcn-svelte"* on npm. <https://www.npmjs.com/package/shadcn-svelte>. Supports: 1.1.x version at time of research.
- **SOURCE-OAPI-CLI** — *"openapi-typescript CLI"*. <https://openapi-ts.dev/cli>. Supports: v7 flags, redocly.yaml, `paths`/`components` typing.
- **SOURCE-OAPI-FETCH** — *"openapi-fetch"*. <https://openapi-ts.dev/openapi-fetch/>. Supports: `createClient<paths>`, `{ data, error }` shape.
- **SOURCE-OAPI-MW** — *"Middleware & Auth"*. <https://openapi-ts.dev/openapi-fetch/middleware-auth>. Supports: `Middleware` interface, `onRequest` / `onResponse`.
- **SOURCE-OAPI-EX** — *"openapi-fetch Examples"*. <https://openapi-ts.dev/openapi-fetch/examples>. Supports: SvelteKit load-function pattern using `fetch` argument.
- **SOURCE-OAPI-V7-ANNOUNCE** — *"v7 Preview"*, openapi-ts/openapi-typescript #1368. <https://github.com/openapi-ts/openapi-typescript/issues/1368>. Supports: v6 → v7 behavior changes.
- **SOURCE-LITESTAR-OPENAPI** — *"OpenAPI"*, Litestar Docs. <https://docs.litestar.dev/2/usage/openapi/index.html>. Supports: OpenAPI 3.1 + YAML/JSON generation.
- **SOURCE-SVELTE-CHECK** — *"svelte-check"*, Socket. <https://socket.dev/npm/package/svelte-check/overview/1.2.5>. Supports: canonical check command.
- **SOURCE-ESLINT-SVELTE-3** — *"Migration Guide - From eslint-plugin-svelte2 to v3"*. <https://sveltejs.github.io/eslint-plugin-svelte/migration/>. Supports: flat-config requirement, Svelte 5 rule support.
- **SOURCE-VITEST-BROWSER** — *"From JSDOM to Real Browsers"*, Scott Spence. <https://scottspence.com/posts/testing-with-vitest-browser-svelte-guide>. Supports: Vitest Browser Mode with Playwright for Svelte 5.
- **SOURCE-SVELTEST** — *"Sveltest Getting Started"*. <https://sveltest.dev/docs/getting-started>. Supports: recommended multi-project test config.
- **SOURCE-SK-FORMS** — *"Forms in SvelteKit — Actions, Validation & Progressive Enhancement"*. <https://dev.to/a1guy/forms-in-sveltekit-actions-validation-progressive-enhancement-3leh>. Supports: `use:enhance` pattern.
- **SOURCE-PROGRAMONAUT-CSRF** — *"Cross-site POST form submissions are forbidden"*. <https://www.programonaut.com/cross-site-post-form-submissions-are-forbidden-in-sveltekit/>. Supports: `ORIGIN` env requirement.

## 16. Quick Reference

### Top rules
1. `RULE-RUNES-001` Use runes. 2. `RULE-SK-LOAD-001` Server-first loads for secrets. 3. `RULE-SK-ERROR-001` Don't `throw` error/redirect. 4. `RULE-SK-STATE-001` Use `$app/state`. 5. `RULE-BUN-001` Bun only. 6. `RULE-UNO-001` UnoCSS `presetWind4` only. 7. `RULE-OAPI-002` `openapi-fetch` typed client. 8. `RULE-SEC-003` Session state in `event.locals`.

### Top decisions
- Computed value → `$derived` (never `$effect`).
- Per-user data → `event.locals`, not module globals.
- Write mutation → form action + `use:enhance`.
- Secret-dependent fetch → server load with `event.fetch`.

### Commands
| Task | Command |
|---|---|
| Install | `bun install` |
| Install in CI | `bun install --frozen-lockfile` |
| Add dep | `bun add <pkg>` / `bun add -D <pkg>` |
| Run script | `bun run <script>` |
| Exec binary | `bunx <bin>` |
| Dev | `bun run dev` |
| Build | `bun run build` |
| Run prod | `ORIGIN=https://host PORT=3000 bun ./build/index.js` |
| Kit sync | `bunx svelte-kit sync` |
| Type/svelte check | `bun run check` (`svelte-kit sync && svelte-check`) |
| Lint | `bun run lint` |
| Format | `bun run format` |
| Unit tests (pure TS) | `bun test` |
| Component tests | `bun run test` (Vitest browser) |
| Regenerate API types | `bun run api:sync` |
| Add shadcn component | `bunx shadcn-svelte@latest add <name>` |

### Top anti-patterns
`ANTI-SVELTE4-001` `$:` · `ANTI-SVELTE4-002` `export let` · `ANTI-SVELTE4-003` `on:click` · `ANTI-SK1-001` `throw error/redirect` · `ANTI-SK1-002` `$page` from `$app/stores` · `ANTI-SK1-007` global `fetch` in load · `ANTI-PM-001` npm/pnpm/yarn · `ANTI-TW-001` real `tailwind.config.js` · `ANTI-ADAPTER-001` `adapter-auto`/`adapter-node` · `ANTI-REACT-001` React idioms · `ANTI-OAPI-LEGACY-001` `openapi-typescript-fetch` · `ANTI-SEC-001` `checkOrigin: false` · `ANTI-SEC-003` server module-level `$state`.

### File-location cheat sheet
| Concern | Location |
|---|---|
| Route page | `src/routes/<path>/+page.svelte` |
| Route server data | `src/routes/<path>/+page.server.ts` |
| Route universal data | `src/routes/<path>/+page.ts` |
| Layout | `src/routes/<path>/+layout.svelte` (+ `+layout.*.ts`) |
| API endpoint | `src/routes/<path>/+server.ts` |
| Error page | `src/routes/+error.svelte` |
| Server hooks | `src/hooks.server.ts` |
| Client hooks | `src/hooks.client.ts` |
| Server-only library | `src/lib/server/**` or `**/*.server.ts` |
| Shared reactive state | `src/lib/state/*.svelte.ts` |
| Generated API types | `src/lib/api/schema.d.ts` |
| Typed API client (server) | `src/lib/api/server.ts` |
| Typed API client (client) | `src/lib/api/client.ts` |
| UnoCSS config | `uno.config.ts` |
| shadcn config | `components.json` (+ stub `tailwind.config.js`) |
| Global CSS | `src/app.css` |
| App types | `src/app.d.ts` |

### Use this, not that
| Use this | Not this |
|---|---|
| `let x = $state(0)` | `let x = 0` (Svelte 4 reactive) |
| `$derived(a + b)` | `$: c = a + b` |
| `$effect(() => ...)` | `$: { ...side-effect... }` |
| `let { foo } = $props()` | `export let foo` |
| `onclick={fn}` | `on:click={fn}` |
| `{@render children()}` | `<slot />` |
| `error(404, ...)` / `redirect(303, ...)` | `throw error(...)` / `throw redirect(...)` |
| `page.url.pathname` from `$app/state` | `$page.url.pathname` from `$app/stores` |
| `event.fetch` in load | global `fetch` in load |
| `bun add -D pkg` | `npm i -D pkg` / `pnpm add -D pkg` |
| `bunx shadcn-svelte@latest add button` | `npx shadcn-ui@latest add button` |
| `svelte-adapter-bun` | `@sveltejs/adapter-auto` / `adapter-node` |
| UnoCSS `presetWind4` + `uno.config.ts` | `tailwind.config.js` + `@tailwindcss/vite` |
| `openapi-fetch` + `openapi-typescript` v7 | `openapi-typescript-fetch` / hand-written DTOs |
| `$lib/server/db.ts` for secrets | Importing secrets into `$lib/` shared modules |
| `bun.lock` (text) | `bun.lockb` (binary, legacy) / `package-lock.json` |
