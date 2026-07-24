## What I did
- Added `src/pages/api/health.ts` returning `{ ok: true }`
- Registered the route in the OpenAPI document

## How to verify
Run `pnpm dev` and hit `GET /api/health`.

## Notes
none

```json
{
  "what": "Added src/pages/api/health.ts returning { ok: true } and registered the route in the OpenAPI document.",
  "howToVerify": "Run pnpm dev and hit GET /api/health — expect a 200 with { ok: true }.",
  "notes": "",
  "checklistItemsDone": ["Add the endpoint"]
}
```
