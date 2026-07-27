# Contributing to Kr8Kan

Kr8Kan is a personal, self-host-only project. Contributions are welcome but
scope is deliberately tight.

## Ground rules

1. **No SaaS surface.** PRs adding billing, plans, seats, cloud analytics, or
   vendor-locked notification/AI services will be closed.
2. **Keep the layering**: schema → repository → tRPC router → pages/views.
   SQL only in repositories; authz only in routers.
3. **Ports are sacred**: web 3310, redis 6380.
4. **Mobile is required.** UI changes must pass the visual QA checklist in
   RECREATION-PROMPT.md §d2 (390px width, touch targets, safe areas).
5. **Design tokens over one-off hex** — use `--kr8-*` / Tailwind semantic
   classes.

## Dev loop

```bash
pnpm install
cp .env.example .env   # set NCB_INSTANCE, NCB_SECRET_KEY, BETTER_AUTH_SECRET
pnpm dev               # http://localhost:3310
pnpm typecheck && pnpm test
```

## Commit style

Conventional-ish: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Keep
subjects under 72 chars.
