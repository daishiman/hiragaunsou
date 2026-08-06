# C3 CLI Reference

## Invocation

```bash
pnpm create cloudflare@latest [name] [-- flags]  # NPM requires --
yarn create cloudflare [name] [flags]
ppnpm create cloudflare@latest [name] [-- flags]
```

## Core Flags

| Flag | Values | Description |
|------|--------|-------------|
| `--type` | `hello-world`, `web-app`, `demo`, `pre-existing`, `remote-template` | Application type |
| `--platform` | `workers` (default), `pages` | Target platform |
| `--framework` | `next`, `remix`, `astro`, `react-router`, `solid`, `svelte`, `qwik`, `vue`, `angular`, `hono` | Web framework (requires `--type=web-app`) |
| `--lang` | `ts`, `js`, `python` | Language (for `--type=hello-world`) |
| `--ts` / `--no-ts` | - | TypeScript for web apps |

## Deployment Flags

| Flag | Description |
|------|-------------|
| `--deploy` / `--no-deploy` | Deploy immediately (prompts interactive, skips in CI) |
| `--git` / `--no-git` | Initialize git (default: yes) |
| `--open` | Open browser after deploy |

## Advanced Flags

| Flag | Description |
|------|-------------|
| `--template=user/repo` | GitHub template or local path |
| `--existing-script=./src/worker.ts` | Existing script (requires `--type=pre-existing`) |
| `--category=ai\|database\|realtime` | Demo filter (requires `--type=demo`) |
| `--experimental` | Enable experimental features |
| `--wrangler-defaults` | Skip wrangler prompts |

## Environment Variables

```bash
CLOUDFLARE_API_TOKEN=xxx    # For deployment
CLOUDFLARE_ACCOUNT_ID=xxx   # Account ID
CF_TELEMETRY_DISABLED=1     # Disable telemetry
```

## Exit Codes

`0` success, `1` user abort, `2` error

## Examples

```bash
# TypeScript Worker
pnpm create cloudflare@latest my-api -- --type=hello-world --lang=ts --no-deploy

# Next.js on Pages
pnpm create cloudflare@latest my-app -- --type=web-app --framework=next --platform=pages --ts

# Astro blog
pnpm create cloudflare@latest my-blog -- --type=web-app --framework=astro --ts --deploy

# CI: non-interactive
pnpm create cloudflare@latest my-app -- --type=web-app --framework=next --ts --no-git --no-deploy

# GitHub template
pnpm create cloudflare@latest -- --template=cloudflare/templates/worker-openapi

# Convert existing project
pnpm create cloudflare@latest . -- --type=pre-existing --existing-script=./build/worker.js
```
