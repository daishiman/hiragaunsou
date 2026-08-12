# C3 Usage Patterns

## Quick Workflows

```bash
# TypeScript API Worker
pnpm create cloudflare@latest my-api -- --type=hello-world --lang=ts --deploy

# Next.js on Pages
pnpm create cloudflare@latest my-app -- --type=web-app --framework=next --platform=pages --ts --deploy

# Astro static site  
pnpm create cloudflare@latest my-blog -- --type=web-app --framework=astro --platform=pages --ts
```

## CI/CD (GitHub Actions)

```yaml
- name: Deploy
  run: pnpm run deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Non-interactive requires:**
```bash
--type=<value>       # Required
--no-git             # Recommended (CI already in git)
--no-deploy          # Deploy separately with secrets
--framework=<value>  # For web-app
--ts / --no-ts       # Required
```

## Monorepo

C3 detects workspace config (`package.json` workspaces or `pnpm-workspace.yaml`).

```bash
cd packages/
pnpm create cloudflare@latest my-worker -- --type=hello-world --lang=ts --no-deploy
```

## Custom Templates

```bash
# GitHub repo
pnpm create cloudflare@latest -- --template=username/repo
pnpm create cloudflare@latest -- --template=cloudflare/templates/worker-openapi

# Local path
pnpm create cloudflare@latest my-app -- --template=../my-template
```

**Template requires `c3.config.json`:**
```json
{
  "name": "my-template",
  "category": "hello-world",
  "copies": [{ "path": "src/" }, { "path": "wrangler.jsonc" }],
  "transforms": [{ "path": "package.json", "jsonc": { "name": "{{projectName}}" }}]
}
```

## Existing Projects

```bash
# Add Cloudflare to existing Worker
pnpm create cloudflare@latest . -- --type=pre-existing --existing-script=./dist/index.js

# Add to existing framework app
pnpm create cloudflare@latest . -- --type=web-app --framework=next --platform=pages --ts
```

## Post-Creation Checklist

1. Review `wrangler.jsonc` - set `compatibility_date`, verify `name`
2. Create bindings: `wrangler kv namespace create`, `wrangler d1 create`, `wrangler r2 bucket create`
3. Generate types: `pnpm run cf-typegen`
4. Test: `pnpm run dev`
5. Deploy: `pnpm run deploy`
6. Set secrets: `wrangler secret put SECRET_NAME`
