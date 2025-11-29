# Modern Bun + Svelte 5 + SvelteKit Best Practices for 2025

**Svelte 5's Runes fundamentally transform how you build reactive applications**—replacing the implicit reactivity and store patterns of Svelte 4 with explicit, universal primitives that work identically inside and outside components. Combined with Bun's native PostgreSQL driver, Drizzle ORM's type-safe queries, and SvelteKit 2.x's mature data loading patterns, this stack offers exceptional developer experience with production-grade performance.

This guide covers **10 critical areas** for greenfield full-stack development: code design, reactivity, data loading, performance, tooling, type safety, security, UI patterns, backend integration, and Docker deployment. Every recommendation is cross-verified against official documentation or authoritative community sources from 2024-2025.

---

## 1. Code design: TypeScript strict patterns and Svelte 5 architecture

### Enable strict TypeScript with SvelteKit-specific options

**Rule:** Configure TypeScript's strictest settings and extend SvelteKit's generated config.

**Rationale:** TypeScript 5.x's strict mode catches null reference errors, implicit any types, and function signature mismatches at compile time. SvelteKit generates route-specific types that provide end-to-end type safety from load functions to components.

```json
// tsconfig.json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true
  }
}
```

**When to deviate:** Disable `exactOptionalPropertyTypes` when integrating with libraries that don't distinguish between `undefined` and missing properties.

*Source: Svelte TypeScript Docs (svelte.dev/docs/typescript), TypeScript 5.x Release Notes*

### Use $props() for component properties with explicit destructuring

**Rule:** Replace `export let` declarations with `$props()` destructuring, using `$bindable()` for two-way binding.

**Rationale:** Svelte 5 unifies property declaration with destructuring syntax, enabling defaults, rest props, and renamed properties in one statement. Properties are NOT bindable by default—explicit `$bindable()` prevents accidental state leakage.

```svelte
<script lang="ts">
  let { 
    required,
    optional = 'default',
    class: className,  // Rename reserved words
    value = $bindable(),  // Explicit two-way binding
    ...rest 
  } = $props();
</script>
```

**Anti-pattern (Svelte 4):**
```svelte
<!-- DON'T: Legacy pattern -->
<script>
  export let required;
  export let optional = 'default';
</script>
```

*Source: Svelte 5 Docs (svelte.dev/docs/svelte/$props), Migration Guide*

### Structure SvelteKit projects with clear separation of concerns

**Rule:** Place server-only code in `$lib/server/`, co-locate load functions with pages, and use route groups for organizational boundaries.

**Rationale:** SvelteKit enforces import restrictions on `$lib/server/`—attempting to import server code in client bundles fails at build time. Route groups `(groupname)` organize pages without affecting URL structure.

```
src/
├── lib/
│   ├── components/          # Reusable UI
│   ├── server/              # Server-only (DB, auth, secrets)
│   │   ├── database.ts
│   │   └── auth.ts
│   └── utils/               # Shared utilities
├── routes/
│   ├── (app)/               # Authenticated routes
│   │   └── +layout.server.ts  # Auth guard
│   ├── (marketing)/         # Public pages
│   └── api/                 # API endpoints
└── hooks.server.ts
```

*Source: SvelteKit Docs (svelte.dev/docs/kit/project-structure)*

### Use snippets instead of slots for component composition

**Rule:** Replace `<slot>` with `{#snippet}` declarations and `{@render}` for flexible content projection.

**Rationale:** Snippets are functions that receive parameters, enabling typed content projection impossible with slots. They work with Svelte 5's reactive system and provide better TypeScript inference.

```svelte
<!-- List.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  
  interface Props<T> {
    items: T[];
    item: Snippet<[T]>;
    empty?: Snippet;
  }
  
  let { items, item, empty }: Props<T> = $props();
</script>

{#if items.length}
  {#each items as entry}
    {@render item(entry)}
  {/each}
{:else}
  {@render empty?.()}
{/if}

<!-- Usage -->
<List {items}>
  {#snippet item(entry)}
    <li>{entry.name}</li>
  {/snippet}
  {#snippet empty()}
    <p>No items found</p>
  {/snippet}
</List>
```

*Source: Svelte 5 Docs (svelte.dev/docs/svelte/snippet)*

---

## 2. Reactivity and state: Runes patterns and migration from stores

### Declare reactive state with $state, computed values with $derived

**Rule:** Use `$state()` for mutable reactive values and `$derived()` for computed values. Reserve `$effect()` exclusively for side effects like DOM manipulation, logging, or external system synchronization.

**Rationale:** Unlike Svelte 4's `$:` reactive statements, Runes explicitly separate state declaration (what changes), derivation (what's computed), and effects (what happens as a result). **90% of cases where you think you need `$effect()` are actually `$derived()` use cases.**

```svelte
<script lang="ts">
  // State - mutable
  let count = $state(0);
  let items = $state<string[]>([]);
  
  // Derived - computed, memoized
  const doubled = $derived(count * 2);
  const total = $derived.by(() => items.reduce((sum, i) => sum + i.length, 0));
  
  // Effect - side effects only
  $effect(() => {
    console.log(`Count changed to ${count}`);
    // Cleanup function (optional)
    return () => console.log('Cleanup');
  });
</script>
```

**Anti-pattern (setting state in $effect):**
```svelte
<!-- DON'T: Use $derived instead -->
<script>
  let count = $state(0);
  let doubled = $state(0);
  
  $effect(() => {
    doubled = count * 2; // ❌ Wrong - creates reactive loop
  });
</script>
```

*Source: Svelte 5 Docs (svelte.dev/docs/svelte/runes), Svelte Blog "Introducing Runes"*

### Choose $state.raw for immutable patterns or large data

**Rule:** Use `$state.raw()` when you replace objects entirely rather than mutating them, or for large datasets where proxy overhead matters.

**Rationale:** `$state()` creates deeply reactive proxies—mutations like `obj.nested.value = x` trigger updates. `$state.raw()` only tracks reassignment, reducing memory overhead for immutable patterns or large arrays you won't mutate in place.

```typescript
// Deep reactivity (default) - mutations trigger updates
let editor = $state({ theme: 'dark', content: '' });
editor.theme = 'light';  // ✅ Triggers update

// Shallow reactivity - only reassignment triggers updates
let logs = $state.raw<LogEntry[]>([]);
logs.push(newLog);  // ❌ No update
logs = [...logs, newLog];  // ✅ Triggers update

// Use $state.snapshot() to get plain object from proxy
console.log($state.snapshot(editor));  // { theme: 'light', content: '' }
```

**When to deviate:** Stick with `$state()` for small objects where mutation convenience outweighs proxy overhead.

*Source: Svelte 5 Docs ($state.raw)*

### Migrate stores to class-based or exported object patterns

**Rule:** For shared state across components, replace Svelte 4 stores with exported `$state` objects or class instances in `.svelte.ts` files.

**Rationale:** Runes work identically inside and outside components, eliminating the API split between stores (`subscribe`/`set`/`update`) and component state. The `.svelte.ts` extension enables Runes in TypeScript files.

```typescript
// store.svelte.ts (Svelte 5)
export class AppState {
  user = $state<User | null>(null);
  isLoading = $state(false);
  
  // Derived values as getters
  isAuthenticated = $derived(this.user !== null);
  
  async login(credentials: Credentials) {
    this.isLoading = true;
    this.user = await authenticate(credentials);
    this.isLoading = false;
  }
}

export const appState = new AppState();
```

**Svelte 4 equivalent (avoid for new code):**
```typescript
// DON'T: Legacy store pattern
import { writable, derived } from 'svelte/store';
export const user = writable<User | null>(null);
export const isAuthenticated = derived(user, $user => $user !== null);
```

*Source: Joy of Code "Different Ways To Share State In Svelte 5" (Nov 2024)*

### Use context API for component-tree scoped state

**Rule:** Pass reactive objects through `setContext`/`getContext` when state should be scoped to a component subtree rather than globally shared.

**Rationale:** Context provides dependency injection without prop drilling while avoiding the server-side issues of global state (which would be shared between requests).

```svelte
<!-- Parent.svelte -->
<script lang="ts">
  import { setContext } from 'svelte';
  
  const counter = $state({ value: 0 });
  setContext('counter', counter);
</script>

<!-- Deeply nested Child.svelte -->
<script lang="ts">
  import { getContext } from 'svelte';
  
  const counter = getContext<{ value: number }>('counter');
</script>

<button onclick={() => counter.value++}>
  {counter.value}
</button>
```

**Anti-pattern (global state in server context):**
```typescript
// DON'T: Shared between all requests on server
export const globalState = $state({ user: null });
```

*Source: Svelte 5 Docs (Context), SvelteKit Auth Patterns*

---

## 3. Data loading and mutations: SvelteKit patterns

### Use +page.server.ts for database access, +page.ts for public APIs

**Rule:** Server load functions (`+page.server.ts`) run only on the server—use them for database queries, secrets, and cookies. Universal load functions (`+page.ts`) run on both server (SSR) and client (navigation)—use them for public API calls.

**Rationale:** Server load functions never expose implementation details or credentials to the client. Universal load functions enable returning non-serializable data (components, functions) and run during client-side navigation without server roundtrip.

```typescript
// +page.server.ts - Server only
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/database';

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionId = cookies.get('session');
  return {
    post: await db.query.posts.findFirst({ where: eq(posts.slug, params.slug) }),
    isOwner: await checkOwnership(sessionId, params.slug)
  };
};

// +page.ts - Universal (server + client)
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, data }) => {
  // data contains server load result
  const comments = await fetch(`/api/comments/${data.post.id}`).then(r => r.json());
  return { ...data, comments };
};
```

*Source: SvelteKit Docs (svelte.dev/docs/kit/load)*

### Implement form actions with progressive enhancement

**Rule:** Export `actions` from `+page.server.ts` for form handling. Use `use:enhance` from `$app/forms` for JavaScript-enhanced submissions that still work without JS.

**Rationale:** Form actions work without JavaScript by default (POST to same URL). The `enhance` action adds client-side niceties (no page reload, loading states, optimistic UI) while maintaining progressive enhancement.

```typescript
// +page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const data = await request.formData();
    const title = data.get('title');
    
    if (!title || typeof title !== 'string') {
      return fail(400, { title, error: 'Title required' });
    }
    
    await db.insert(posts).values({ title, authorId: locals.user.id });
    redirect(303, '/posts');
  }
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';
  
  let { form }: PageProps = $props();
</script>

<form method="POST" action="?/create" use:enhance>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <input name="title" value={form?.title ?? ''} />
  <button>Create</button>
</form>
```

*Source: SvelteKit Docs (svelte.dev/docs/kit/form-actions)*

### Stream non-essential data with nested promises

**Rule:** Return promises (not awaited) from server load functions to stream secondary data after initial page render.

**Rationale:** Streaming sends essential content immediately while non-blocking data loads in parallel. Users see meaningful content faster while secondary data renders progressively.

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ params }) => {
  return {
    // Essential - awaited, blocks render
    post: await db.query.posts.findFirst({ where: eq(posts.slug, params.slug) }),
    
    // Streamed - promise, renders loading state first
    comments: loadComments(params.slug),  // NOT awaited
    relatedPosts: loadRelatedPosts(params.slug)  // NOT awaited
  };
};
```

```svelte
<!-- +page.svelte -->
<article>{data.post.content}</article>

{#await data.comments}
  <p>Loading comments...</p>
{:then comments}
  {#each comments as comment}<Comment {comment} />{/each}
{:catch}
  <p>Failed to load comments</p>
{/await}
```

**When to deviate:** Streaming requires JavaScript—await all data for critical SEO content or no-JS scenarios.

*Source: Svelte Blog "Streaming, snapshots, and other new features" (2023)*

### Invalidate data with depends() and invalidate()

**Rule:** Use `depends('custom:key')` in load functions and `invalidate('custom:key')` to trigger selective data reloading.

**Rationale:** SvelteKit automatically tracks `fetch` URLs as dependencies. Custom dependencies enable invalidating data that doesn't come from fetch (database queries, computed values).

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ depends }) => {
  depends('app:todos');  // Custom dependency
  return { todos: await db.query.todos.findMany() };
};

// Component
import { invalidate } from '$app/navigation';

async function refresh() {
  await invalidate('app:todos');  // Reruns load function
}
```

*Source: SvelteKit Docs ($app/navigation)*

---

## 4. Performance: Bun runtime and Svelte 5 compiler optimizations

### Configure Bun's native PostgreSQL connection pool appropriately

**Rule:** Set pool size based on workload (**10-25 connections** for most applications), with idle timeout and max lifetime to prevent stale connections.

**Rationale:** Bun's `bun:sql` includes built-in connection pooling. Over-provisioning wastes database resources; under-provisioning causes connection wait times. The formula `(cores * 2) + spindles` works for CPU-bound workloads.

```typescript
// src/lib/server/database.ts
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const client = new SQL({
  url: process.env.DATABASE_URL!,
  max: 20,                    // Pool size
  idleTimeout: 30,            // Close idle after 30s
  maxLifetime: 60 * 30,       // Recycle connections after 30min
  connectionTimeout: 30,       // Acquisition timeout
});

export const db = drizzle({ client, schema });
```

*Source: Bun Docs (bun.com/docs/runtime/sql), Drizzle Docs (orm.drizzle.team)*

### Use Drizzle prepared statements for repeated queries

**Rule:** Create prepared statements for frequently executed queries to skip query planning overhead.

**Rationale:** PostgreSQL caches execution plans for prepared statements. For high-frequency queries (authentication checks, pagination), this eliminates repeated parsing and planning.

```typescript
import { sql } from 'drizzle-orm';

// Prepare once at module level
const getUserById = db
  .select()
  .from(users)
  .where(eq(users.id, sql.placeholder('id')))
  .prepare('get_user_by_id');

// Execute many times with different values
const user = await getUserById.execute({ id: userId });
```

*Source: Drizzle Docs (orm.drizzle.team/docs/perf-queries)*

### Configure UnoCSS with attributify mode and shortcuts

**Rule:** Use UnoCSS's attributify preset for cleaner templates and define shortcuts for repeated utility combinations.

**Rationale:** Attributify mode reduces class attribute noise by grouping utilities by category. Shortcuts create semantic abstractions over utility combinations, improving readability and maintainability.

```typescript
// uno.config.ts
import { defineConfig, presetUno, presetAttributify } from 'unocss';

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify({ prefix: 'un-' })
  ],
  shortcuts: {
    'btn': 'py-2 px-4 font-semibold rounded-lg shadow-md transition-colors',
    'btn-primary': 'btn bg-primary text-primary-foreground hover:bg-primary/90',
    'input-base': 'border rounded px-3 py-2 focus:outline-none focus:ring-2'
  }
});
```

```svelte
<!-- Attributify mode -->
<button 
  bg="blue-500 hover:blue-700"
  text="white sm"
  p="y-2 x-4"
  rounded
>
  Button
</button>
```

*Source: UnoCSS Docs (unocss.dev/presets/attributify)*

### Optimize Lucide icons with direct imports

**Rule:** Import icons directly from `@lucide/svelte/icons/icon-name` rather than barrel imports.

**Rationale:** Barrel imports (`import { Icon } from 'lucide-svelte'`) can include all icons in the bundle. Direct imports enable proper tree-shaking, reducing bundle size significantly.

```svelte
<script>
  // ✅ Direct import - tree-shakeable
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import User from '@lucide/svelte/icons/user';
  
  // ❌ Barrel import - may include all icons
  // import { CircleAlert, User } from 'lucide-svelte';
</script>
```

*Source: Lucide Docs (lucide.dev/guide/packages/lucide-svelte)*

---

## 5. Tooling and QA: Testing, linting, and validation

### Use Vitest with browser mode for component tests

**Rule:** Configure Vitest with `@vitest/browser-playwright` for component tests that run in real browsers, not jsdom.

**Rationale:** Browser mode tests Svelte components in actual DOM environments, catching CSS issues and browser-specific behaviors that jsdom misses. Playwright provides consistent cross-browser testing.

```typescript
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  test: {
    projects: [
      {
        test: {
          name: 'client',
          browser: {
            enabled: true,
            provider: playwright,
            instances: [{ browser: 'chromium' }]
          },
          include: ['src/**/*.svelte.test.ts']
        }
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.server.test.ts']
        }
      }
    ]
  }
});
```

*Source: Vitest Docs (vitest.dev), Testing Library Svelte Setup*

### Configure Playwright for E2E with SvelteKit's preview server

**Rule:** Point Playwright's `webServer` at SvelteKit's build + preview command for production-like E2E tests.

**Rationale:** Testing against the production build catches adapter-specific issues, environment variable handling, and SSR/hydration bugs that don't appear in dev mode.

```typescript
// playwright.config.ts
import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  webServer: {
    command: 'bun run build && bun run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI
  },
  testDir: 'tests',
  use: { baseURL: 'http://localhost:4173' }
};

export default config;
```

*Source: Svelte Docs (svelte.dev/docs/svelte/testing), Playwright Docs*

### Choose Valibot over Zod for client-side validation

**Rule:** Use Valibot for validation schemas that run in the browser; consider Zod for server-only validation with complex needs.

**Rationale:** Valibot's modular architecture produces **~90% smaller bundles** than Zod (~1.4KB vs ~13.5KB) with comparable functionality. Both integrate with superforms.

```typescript
// Valibot (smaller bundle)
import * as v from 'valibot';

const UserSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  age: v.pipe(v.number(), v.minValue(18))
});

type User = v.InferOutput<typeof UserSchema>;

// Zod equivalent
import { z } from 'zod';

const UserSchemaZod = z.object({
  email: z.string().email(),
  age: z.number().min(18)
});
```

*Source: Valibot Docs (valibot.dev/guides/comparison/), Builder.io Introduction*

### Run svelte-check in CI pipelines

**Rule:** Include `svelte-check` in your CI workflow to catch type errors across `.svelte` files.

**Rationale:** TypeScript's `tsc` doesn't check Svelte files. `svelte-check` validates props, event handlers, and template expressions, catching errors before deployment.

```json
// package.json
{
  "scripts": {
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-check --watch"
  }
}
```

*Source: Svelte CLI Docs (svelte.dev/docs/cli/sv-check)*

---

## 6. Type safety: Drizzle inference and SvelteKit generated types

### Infer types from Drizzle schema definitions

**Rule:** Use `$inferSelect` and `$inferInsert` to derive TypeScript types from table definitions rather than duplicating type declarations.

**Rationale:** Single source of truth—schema changes automatically propagate to TypeScript types, eliminating sync issues between database structure and application types.

```typescript
// schema.ts
export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Inferred types
type User = typeof users.$inferSelect;      // { id: number; email: string; ... }
type NewUser = typeof users.$inferInsert;   // { email: string; name: string; ... }
```

*Source: Drizzle Docs (orm.drizzle.team/docs/sql-schema-declaration)*

### Use PageProps from ./$types for Svelte 5 components

**Rule:** Import `PageProps` from `./$types` (SvelteKit 2.16+) to type both `data` and `form` props in one interface.

**Rationale:** SvelteKit generates route-specific types from your load functions and actions. `PageProps` combines `PageData` and `ActionData` for Svelte 5's `$props()` pattern.

```svelte
<script lang="ts">
  import type { PageProps } from './$types';
  
  let { data, form }: PageProps = $props();
  // data is typed from load function return
  // form is typed from actions return
</script>
```

*Source: SvelteKit Docs (svelte.dev/docs/kit/types)*

### Apply satisfies for configuration objects

**Rule:** Use TypeScript's `satisfies` operator for configuration objects to validate structure while preserving literal types.

**Rationale:** Unlike type annotations that widen types, `satisfies` validates conformance while keeping inferred literal types intact—enabling autocomplete and type narrowing.

```typescript
type Route = { path: string; prerender?: boolean };

// satisfies validates AND preserves literal types
const routes = {
  home: { path: '/', prerender: true },
  about: { path: '/about' }
} satisfies Record<string, Route>;

type RouteKey = keyof typeof routes;  // "home" | "about" (not string)
routes.home.path;  // TypeScript knows this is "/"
```

*Source: TypeScript 4.9 Release Notes*

---

## 7. Security: SQL injection prevention and authentication

### Rely on Drizzle's automatic parameterization

**Rule:** Use Drizzle's query builder or `sql` template literal—never string concatenation for dynamic values.

**Rationale:** Drizzle automatically parameterizes all values in template literals and query builder methods. The only unsafe API is `sql.raw()`, which should never receive user input.

```typescript
// ✅ SAFE: Automatic parameterization
const userId = 69;
await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);
// Generated: SELECT * FROM users WHERE id = $1  [69]

// ✅ SAFE: Query builder
await db.select().from(users).where(eq(users.email, userInput));

// ❌ DANGEROUS: sql.raw() does NOT escape
await db.execute(sql.raw(`SELECT * FROM users WHERE id = ${userInput}`));
```

*Source: Drizzle Docs (orm.drizzle.team/docs/sql)*

### Implement authentication in hooks.server.ts

**Rule:** Validate sessions in the `handle` hook and populate `event.locals` with user data for downstream access.

**Rationale:** Hooks run before every request, providing a centralized authentication checkpoint. `event.locals` carries authenticated user data through the request lifecycle.

```typescript
// hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get('session');
  
  if (sessionId) {
    event.locals.user = await validateSession(sessionId);
  }
  
  // Protect routes
  if (event.url.pathname.startsWith('/app') && !event.locals.user) {
    redirect(303, '/login');
  }
  
  return resolve(event);
};
```

```typescript
// app.d.ts
declare global {
  namespace App {
    interface Locals {
      user: { id: string; name: string } | null;
    }
  }
}
```

*Source: SvelteKit Docs (svelte.dev/docs/kit/hooks)*

### Configure security headers via hooks

**Rule:** Set security headers (HSTS, X-Frame-Options, CSP) in the `handle` hook response.

**Rationale:** Security headers protect against clickjacking, XSS, and protocol downgrade attacks. Applying them in hooks ensures consistent coverage across all routes.

```typescript
// hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 
      'max-age=31536000; includeSubDomains');
  }
  
  return response;
};
```

*Source: SvelteKit Docs (Configuration CSP), Nosecone Library Docs*

---

## 8. UI patterns: shadcn-svelte and form handling

### Integrate shadcn-svelte with UnoCSS via unocss-preset-shadcn

**Rule:** Use `unocss-preset-shadcn` to replace Tailwind while maintaining shadcn-svelte component compatibility.

**Rationale:** UnoCSS's on-demand engine outperforms Tailwind's JIT in build speed. The preset provides shadcn-compatible CSS variables and utilities.

```typescript
// uno.config.ts
import { presetWind } from '@unocss/preset-wind3';
import { defineConfig } from 'unocss';
import presetAnimations from 'unocss-preset-animations';
import { presetShadcn } from 'unocss-preset-shadcn';

export default defineConfig({
  presets: [
    presetWind(),
    presetAnimations(),
    presetShadcn({ color: 'slate' })
  ]
});
```

**Note:** Keep an empty `tailwind.config.js` for shadcn CLI compatibility.

*Source: unocss-preset-shadcn GitHub*

### Use superforms with shadcn-svelte Form components

**Rule:** Combine sveltekit-superforms for validation logic with shadcn-svelte's Form components for accessible UI.

**Rationale:** Superforms handles validation, error state, and progressive enhancement. shadcn-svelte Form components provide accessible labels, descriptions, and error messages with proper ARIA attributes.

```svelte
<script lang="ts">
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import { superForm } from 'sveltekit-superforms';
  import { valibot } from 'sveltekit-superforms/adapters';

  let { data } = $props();
  
  const form = superForm(data.form, {
    validators: valibot(schema)
  });
  const { form: formData, enhance } = form;
</script>

<form method="POST" use:enhance>
  <Form.Field {form} name="email">
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label>Email</Form.Label>
        <Input {...props} bind:value={$formData.email} />
      {/snippet}
    </Form.Control>
    <Form.Description>Your work email</Form.Description>
    <Form.FieldErrors />
  </Form.Field>
  <Form.Button>Submit</Form.Button>
</form>
```

*Source: superforms.rocks, shadcn-svelte.com*

---

## 9. Backend patterns: *arr APIs, Croner scheduling, webhooks

### Authenticate *arr API calls with X-Api-Key header

**Rule:** Use the `X-Api-Key` header for Radarr/Sonarr authentication. Wrap API calls in a typed client with error handling.

**Rationale:** *arr applications use API key authentication (not OAuth). A typed client ensures consistent error handling and timeout configuration.

```typescript
// src/lib/server/arr-client.ts
interface ArrConfig {
  baseUrl: string;
  apiKey: string;
}

export async function arrFetch<T>(
  config: ArrConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${config.baseUrl}/api/v3/${endpoint}`, {
    ...options,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`arr API error: ${response.status}`);
  }

  return response.json();
}

// Usage
const movies = await arrFetch<Movie[]>(
  { baseUrl: process.env.RADARR_URL!, apiKey: process.env.RADARR_API_KEY! },
  'movie'
);
```

*Source: Radarr API Docs (radarr.video/docs/api/)*

### Schedule background tasks with Croner

**Rule:** Use Croner for cron-based scheduling with built-in overrun protection and error handling.

**Rationale:** Croner is TypeScript-native, supports Bun, and provides `protect: true` to prevent overlapping executions of slow jobs.

```typescript
// src/lib/server/scheduler.ts
import { Cron } from 'croner';

// Initialize in hooks.server.ts (runs once on startup)
export function initializeJobs() {
  // Sync every 15 minutes with overrun protection
  new Cron('*/15 * * * *', {
    name: 'radarr-sync',
    protect: true,
    catch: (err) => console.error('Sync failed:', err)
  }, async () => {
    await syncRadarrLibrary();
  });
  
  // Cleanup at 2 AM daily
  new Cron('0 2 * * *', {
    name: 'cleanup',
    timezone: 'America/New_York'
  }, cleanupOldData);
}
```

*Source: Croner GitHub (github.com/Hexagon/croner)*

### Handle webhooks with raw body access for signature verification

**Rule:** Use `request.text()` (not `request.json()`) when webhook signatures require the raw body.

**Rationale:** Signature verification algorithms hash the exact bytes received. Parsing to JSON then re-serializing may produce different bytes, causing verification failures.

```typescript
// src/routes/webhooks/stripe/+server.ts
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();  // Raw body for signature
  const signature = request.headers.get('stripe-signature')!;
  
  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    WEBHOOK_SECRET
  );
  
  // Process event...
  return new Response('OK');
};
```

*Source: SvelteKit Docs (svelte.dev/docs/kit/routing)*

---

## 10. Docker and deployment: Multi-stage builds and adapter selection

### Use svelte-adapter-bun for Bun-native deployments

**Rule:** Use `svelte-adapter-bun` (community-maintained) rather than adapter-node when deploying with Bun runtime.

**Rationale:** adapter-node has known compatibility issues with Bun (hostname/unix socket conflicts). svelte-adapter-bun is Bun-native with WebSocket support and precompression.

```javascript
// svelte.config.js
import adapter from 'svelte-adapter-bun';

export default {
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: true,
      envPrefix: ''
    })
  }
};
```

**Known limitation:** `bun build --compile` (single executable) doesn't work with SvelteKit yet.

*Source: svelte-adapter-bun GitHub, Bun Ecosystem Docs*

### Build multi-stage Dockerfiles with BuildKit cache mounts

**Rule:** Use multi-stage builds separating dependency installation, build, and runtime stages. Leverage BuildKit cache mounts for faster rebuilds.

**Rationale:** Multi-stage builds minimize final image size by excluding build tools. Cache mounts persist Bun's package cache between builds, dramatically speeding up CI.

```dockerfile
FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies with cache
FROM base AS deps
COPY package.json bun.lock ./
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Build application
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Production image
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./

USER bun
EXPOSE 3000
CMD ["bun", "./build/index.js"]
```

*Source: Bun Docker Docs (bun.com/docs/guides/ecosystem/docker)*

### Configure PostgreSQL with health checks and proper secrets

**Rule:** Use Docker secrets for database passwords and configure health checks for dependency ordering.

**Rationale:** Secrets avoid password exposure in environment variables (visible in `docker inspect`). Health checks ensure the database is ready before the application starts.

```yaml
# docker-compose.yml
services:
  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://user:${DB_PASSWORD}@db:5432/app
    
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

*Source: Docker Postgres Official Image Docs, Sliplane Best Practices*

---

## Drizzle configuration reference

```typescript
// drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/lib/server/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  },
  migrations: {
    prefix: 'timestamp',
    table: '__drizzle_migrations__'
  },
  strict: true,
  verbose: true
});
```

**Commands:**
- `bunx drizzle-kit generate` — Generate migrations from schema changes
- `bunx drizzle-kit migrate` — Apply pending migrations
- `bunx drizzle-kit push` — Push schema directly (dev only)
- `bunx drizzle-kit studio` — Open database GUI

*Source: Drizzle Kit Docs (orm.drizzle.team/docs/drizzle-config-file)*

---

## Migration checklist: Svelte 4 → Svelte 5

| Svelte 4 Pattern | Svelte 5 Replacement | Notes |
|-----------------|---------------------|-------|
| `export let prop` | `let { prop } = $props()` | Use `$bindable()` for two-way binding |
| `$: derived = x * 2` | `const derived = $derived(x * 2)` | Use `$derived.by()` for complex logic |
| `$: { sideEffect() }` | `$effect(() => { sideEffect() })` | Runs after DOM updates |
| `<slot>` | `{#snippet}` + `{@render}` | Snippets are typed functions |
| `createEventDispatcher` | Callback props | `let { onEvent } = $props()` |
| `writable/readable` stores | `$state` in `.svelte.ts` | Same API everywhere |
| `use:action` | `use:action` | Unchanged |

**CLI migration:** `npx sv migrate svelte-5`

*Source: Svelte 5 Migration Guide (svelte.dev/docs/svelte/v5-migration-guide)*