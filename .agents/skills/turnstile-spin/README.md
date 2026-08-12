# turnstile-spin (skill)

End-to-end setup skill for Cloudflare Turnstile. Loads when an agent is asked to add Turnstile, set up CAPTCHA, or protect a form from bots.

This is a mirror of the canonical docs page at [`developers.cloudflare.com/turnstile/spin`](https://developers.cloudflare.com/turnstile/spin/). If the two disagree, the docs page wins.

## Layout

| File                              | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `SKILL.md`                        | Main wizard instructions for the agent                                 |
| `scripts/auth-probe.sh`           | Probes the customer's Cloudflare API token for Turnstile scope         |
| `scripts/widget-create.sh`        | Creates the Turnstile widget via the Cloudflare API                    |
| `scripts/fetch-secret.sh`         | Retrieves the secret for an existing widget (recovery flow)            |
| `scripts/validate.sh`             | Dummy-siteverify + hostname check at the end of the wizard             |
| `scripts/persist-skill.sh`        | Installs the canonical skill bundle into the user's repo               |
| `references/vanilla-html.md`      | Code snippet for static / vanilla HTML projects                        |
| `references/nextjs-app.md`        | Code snippet for Next.js App Router projects                           |
| `references/nextjs-pages.md`      | Code snippet for Next.js Pages Router projects                         |
| `references/astro.md`             | Code snippet for Astro projects                                        |
| `references/sveltekit.md`         | Code snippet for SvelteKit projects                                    |
| `references/hugo.md`              | Code snippet for Hugo projects                                         |
| `tests/validation.md`             | Validation cases matching the assertions in the PRD                    |

## How agents load it

Agents that load skill bundles from `github.com/cloudflare/skills` will pick this up automatically. For Claude Code or Codex repository-local installation:

```sh
# Claude Code
mkdir -p .claude/skills/turnstile-spin && \
  curl -sSL https://developers.cloudflare.com/turnstile/spin.md \
  -o .claude/skills/turnstile-spin/SKILL.md

# Codex
mkdir -p .agents/skills/turnstile-spin && \
  curl -sSL https://developers.cloudflare.com/turnstile/spin.md \
  -o .agents/skills/turnstile-spin/SKILL.md

# Or, install the whole skills bundle and link it for both clients
git clone https://github.com/cloudflare/skills ~/.config/cloudflare-skills
ln -s ~/.config/cloudflare-skills/skills/turnstile-spin ~/.claude/skills/turnstile-spin
ln -s ~/.config/cloudflare-skills/skills/turnstile-spin ~/.agents/skills/turnstile-spin
```

For other clients, choose that client's documented skill-discovery location. Step 11 in [`SKILL.md`](./SKILL.md#conversation-flow) performs the same client-aware selection.

## Sync with the docs page

The canonical source of truth is `src/content/docs/turnstile/spin.mdx` in the `cloudflare-docs` repo. This skill mirrors that content with the JSX stripped out. CI keeps them in sync on each docs release; if you are hand-editing, mirror your change to both places.

## Related

- [Canonical docs page](https://developers.cloudflare.com/turnstile/spin/)
- [`cloudflare/skills`](https://github.com/cloudflare/skills) — root index for all Cloudflare agent skills
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) — canonical siteverify reference
