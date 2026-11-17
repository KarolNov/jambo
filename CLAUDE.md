# jambo

Collaborative music board on Cloudflare Workers: Hono + React SPA in one Worker (Vite + `@cloudflare/vite-plugin`), one `Board` Durable Object per jam (`y-partyserver`), client state in a Yjs doc read and written through duratom atoms.

- Read and write the board doc only through duratom atoms (`src/board/model.ts`). Its rules are in `node_modules/duratom/skills/duratom/SKILL.md`.
- Slug rules are shared by Worker and client in `shared/slug.ts`.
- After changing `wrangler.jsonc`, run `pnpm cf-typegen` to regenerate `worker-configuration.d.ts`.
- Check work with `pnpm typecheck`, `pnpm test` and `pnpm format:check`.

Specs for this repo live in [Notion](https://app.notion.com/p/41b43cce21f281a8aedffc816ffb7b69); `.blueprint/blueprint.json` maps capabilities to code. After changing behavior in an anchored area on purpose, run `/blueprint-sync <capability>`; to check the code still does what the specs say, run `/blueprint-drift`.
