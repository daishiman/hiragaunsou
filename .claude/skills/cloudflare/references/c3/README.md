# C3 (create-cloudflare)

Official CLI for scaffolding Cloudflare Workers and Pages projects with templates, TypeScript, and instant deployment.

## Quick Start

```bash
# Interactive (recommended for first-time)
pnpm create cloudflare@latest my-app

# Worker (API/WebSocket/Cron)
pnpm create cloudflare@latest my-api -- --type=hello-world --ts

# Pages (static/SSG/full-stack)
pnpm create cloudflare@latest my-site -- --type=web-app --framework=astro --platform=pages
```

## Platform Decision Tree

```
What are you building?

├─ API / WebSocket / Cron / Email handler
│   └─ Workers (default) - no --platform flag needed
│       pnpm create cloudflare@latest my-api -- --type=hello-world

├─ Static site / SSG / Documentation
│   └─ Pages - requires --platform=pages
│       pnpm create cloudflare@latest my-site -- --type=web-app --framework=astro --platform=pages

├─ Full-stack app (Next.js/Remix/SvelteKit)
│   ├─ Need Durable Objects, Queues, or Workers-only features?
│   │   └─ Workers (default)
│   └─ Otherwise use Pages for git integration and branch previews
│       └─ Add --platform=pages

└─ Convert existing project
    └─ pnpm create cloudflare@latest . -- --type=pre-existing --existing-script=./src/worker.ts
```

**Critical:** Pages projects require `--platform=pages` flag. Without it, C3 defaults to Workers.

## Interactive Flow

When run without flags, C3 prompts in this order:

1. **Project name** - Directory to create (defaults to current dir with `.`)
2. **Application type** - `hello-world`, `web-app`, `demo`, `pre-existing`, `remote-template`
3. **Platform** - `workers` (default) or `pages` (for web apps only)
4. **Framework** - If web-app: `next`, `remix`, `astro`, `react-router`, `solid`, `svelte`, etc.
5. **TypeScript** - `yes` (recommended) or `no`
6. **Git** - Initialize repository? `yes` or `no`
7. **Deploy** - Deploy now? `yes` or `no` (requires `wrangler login`)

## Installation Methods

```bash
# NPM
pnpm create cloudflare@latest

# Yarn
yarn create cloudflare

# PNPM
ppnpm create cloudflare@latest
```

## In This Reference

| File | Purpose | Use When |
|------|---------|----------|
| **api.md** | Complete CLI flag reference | Scripting, CI/CD, advanced usage |
| **configuration.md** | Generated files, bindings, types | Understanding output, customization |
| **patterns.md** | Workflows, CI/CD, monorepos | Real-world integration |
| **gotchas.md** | Troubleshooting failures | Deployment blocked, errors |

## Reading Order

| Task | Read |
|------|------|
| Create first project | README only |
| Set up CI/CD | README → api → patterns |
| Debug failed deploy | gotchas |
| Understand generated files | configuration |
| Full CLI reference | api |
| Create custom template | patterns → configuration |
| Convert existing project | README → patterns |

## Post-Creation

```bash
cd my-app

# Local dev with hot reload
pnpm run dev

# Generate TypeScript types for bindings
pnpm run cf-typegen

# Deploy to Cloudflare
pnpm run deploy
```

## See Also

- **workers/README.md** - Workers runtime, bindings, APIs
- **workers-ai/README.md** - AI/ML models
- **pages/README.md** - Pages-specific features
- **wrangler/README.md** - Wrangler CLI beyond initial setup
- **d1/README.md** - SQLite database
- **r2/README.md** - Object storage
