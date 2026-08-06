# Cloudflare Pages

JAMstack platform for full-stack apps on Cloudflare's global network.

## Key Features

- **Git-based deploys**: Auto-deploy from GitHub/GitLab
- **Preview deployments**: Unique URL per branch/PR
- **Pages Functions**: File-based serverless routing (Workers runtime)
- **Static + dynamic**: Smart asset caching + edge compute
- **Smart Placement**: Automatic function optimization based on traffic patterns
- **Framework optimized**: SvelteKit, Astro, Nuxt, Qwik, Solid Start

## Deployment Methods

### 1. Git Integration (Production)
Dashboard → Workers & Pages → Create → Connect to Git → Configure build

### 2. Direct Upload
```bash
pnpm wrangler pages deploy ./dist --project-name=my-project
pnpm wrangler pages deploy ./dist --project-name=my-project --branch=staging
```

### 3. C3 CLI
```bash
pnpm create cloudflare@latest my-app
# Select framework → auto-setup + deploy
```

## vs Workers

- **Pages**: Static sites, JAMstack, frameworks, git workflow, file-based routing
- **Workers**: Pure APIs, complex routing, WebSockets, scheduled tasks, email handlers
- **Combine**: Pages Functions use Workers runtime, can bind to Workers

## Quick Start

```bash
# Create
pnpm create cloudflare@latest

# Local dev
pnpm wrangler pages dev ./dist

# Deploy
pnpm wrangler pages deploy ./dist --project-name=my-project

# Types
pnpm wrangler types --path='./functions/types.d.ts'

# Secrets
echo "value" | pnpm wrangler pages secret put KEY --project-name=my-project

# Logs
pnpm wrangler pages deployment tail --project-name=my-project
```

## Resources

- [Pages Docs](https://developers.cloudflare.com/pages/)
- [Functions API](https://developers.cloudflare.com/pages/functions/api-reference/)
- [Framework Guides](https://developers.cloudflare.com/pages/framework-guides/)
- [Discord #functions](https://discord.com/channels/595317990191398933/910978223968518144)

## Reading Order

**New to Pages?** Start here:
1. README.md (you are here) - Overview & quick start
2. [configuration.md](./configuration.md) - Project setup, wrangler.jsonc, bindings
3. [api.md](./api.md) - Functions API, routing, context
4. [patterns.md](./patterns.md) - Common implementations
5. [gotchas.md](./gotchas.md) - Troubleshooting & pitfalls

**Quick reference?** Jump to relevant file above.

## In This Reference

- [configuration.md](./configuration.md) - wrangler.jsonc, build, env vars, Smart Placement
- [api.md](./api.md) - Functions API, bindings, context, advanced mode
- [patterns.md](./patterns.md) - Full-stack patterns, framework integration
- [gotchas.md](./gotchas.md) - Build issues, limits, debugging, framework warnings

## See Also

- [pages-functions](../pages-functions/) - File-based routing, middleware
- [d1](../d1/) - SQL database for Pages Functions
- [kv](../kv/) - Key-value storage for caching/state
