# jambo

Collaborative music board on Cloudflare Workers: Hono + React SPA in one Worker (Vite + `@cloudflare/vite-plugin`), one `Board` Durable Object per jam (`y-partyserver`), client state in a Yjs doc read and written through duratom atoms.

- Write to the board doc only through the board SDK in `shared/board/` (operations applied by `apply`); read it through duratom atoms (`src/board/model.ts`). duratom's rules are in `node_modules/duratom/skills/duratom/SKILL.md`.
- New kinds of change get a new operation in `shared/board/ops.ts` with tests in `test/board.test.ts`, never a direct doc write.
- Slug rules are shared by Worker and client in `shared/slug.ts`.
- For UI work, follow `DESIGN.md` (tokens, depth, focus, colour, when to use each `src/ui` control); `/ds` shows the controls live.
- After changing `wrangler.jsonc`, run `pnpm cf-typegen` to regenerate `worker-configuration.d.ts`.
- Check work with `pnpm check`: format check, typecheck, `pnpm test` and `pnpm e2e`. CI skips `pnpm e2e` (the Playwright tests in `e2e/`, against the local Worker only; deployed dev environments are behind Cloudflare Access), so this is the only place they run.

Specs for this repo live in [Notion](https://app.notion.com/p/41b43cce21f281a8aedffc816ffb7b69); `.blueprint/blueprint.json` maps capabilities to code. After changing behavior in an anchored area on purpose, run `/blueprint-sync <capability>`; to check the code still does what the specs say, run `/blueprint-drift`.
