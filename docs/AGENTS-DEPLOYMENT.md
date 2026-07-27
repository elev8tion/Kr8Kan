# Agents: deployment model + ops notes

## Runner mode: in-process

Pi workers run **inside the web server's Node process** (`runnerMode:
"in-process"` in `agent.health`). That means:

- Kr8Kan agents require a **long-lived Node process** — no serverless, no
  horizontally scaled multi-instance deploys for the agent features. One web
  instance owns the runner.
- Job **state** is durable (DB table `agent_job`), so a crash or restart
  never leaves permanent `running` rows: on boot the reaper fails out any
  job stuck `running`/`pending` past its timeout budget with
  `error: "orphaned"`.
- Extracting the runner into a sidecar process is a documented future
  option, not built.

## Concurrency and limits

| Env                              | Default | Meaning                                                                          |
| -------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `KR8KAN_PI_MAX_CONCURRENT`       | 4       | Global concurrent pi processes; excess jobs queue as `pending` (in-process FIFO) |
| `KR8KAN_PI_MAX_CONCURRENT_TOOLS` | 1       | Lower lane for tool-enabled (dev-task) runs                                      |
| `KR8KAN_PI_MAX_PER_USER`         | 3       | Per-user concurrent (pending+running) jobs                                       |
| `KR8KAN_PI_MAX_PER_HOUR`         | 30      | Per-user runs per hour                                                           |
| `KR8KAN_PI_TOOL_TIMEOUT_MS`      | 900000  | Wall clock for tools runs (also the verify-command budget)                       |

Additionally one **project-folder lock**: at most one live dev-task per
`projectPath`, enforced against the DB.

## Workflow scheduler

`schedule` and `card.due` workflow triggers are driven by an in-process
hourly tick (installed on the same boot hook as the job store). Same
deployment constraint as the runner: exactly one long-lived instance. See
`docs/WORKFLOWS.md`.

## Changelog note — flat-file jobs

Jobs used to live as flat JSON under `.kr8kan/jobs/`. They are now DB rows
(`agent_job`). Old flat-file jobs are **not migrated** — jobs are ephemeral
run artifacts; history starts fresh after upgrading. The file store remains
only as the standalone/test fallback when no DB store is injected.

## Structured output / prompt versions

Every stock worker's prompt demands one fenced ```json block; the runner
parses it fail-closed into `resultParsed` (`parseError` set otherwise —
run still counts as completed, apply stays blocked). `promptVersion` is
stamped on each job so results keep parsing under the contract they were
produced with when schemas evolve.

## Tools honesty note

The prompt-level deny list for tools runs (`git push`, recursive deletes,
network installers) is advice to the model, **not a sandbox**. The real
rails are: `KR8KAN_PI_ALLOW_TOOLS` opt-in, the `KR8KAN_PI_PROJECT_ROOTS`
folder allowlist, the scrubbed environment, and the per-folder lock.
Treat any folder you link as writable by the agent.

## Driving other projects

Kr8Kan is the control surface; the work happens in whatever folder a board
points at. Nothing about a dev-task is Kr8Kan-specific — **one board per
repo** is the intended shape.

Each board carries three settings, all under Board settings:

| Setting        | Purpose                        | Example                 |
| -------------- | ------------------------------ | ----------------------- |
| Project folder | Repo the dev-task edits        | `/Users/kc/blocky`      |
| Verify command | How that project proves itself | `pnpm test`             |
| Dev URL        | That project's dev server      | `http://localhost:5173` |

Two environment switches gate the whole thing:

- `KR8KAN_PI_ALLOW_TOOLS=true` — without it, every worker runs `--no-tools`
  and can only _recommend_ changes.
- `KR8KAN_PI_PROJECT_ROOTS` — colon-separated absolute paths. A board's
  project folder must sit inside one of them.

Board settings always shows the Project folder field, but its hint tells you
which state you are in: _"Tool runs are off"_ until the opt-in, then the
list of allowed roots. **Verify command and Dev URL only appear once a
project folder is filled in** — so an empty allowlist looks like the two
fields are missing rather than gated.

The operator starts the target project's dev server; Kr8Kan never does.
A run then: copies the repo into a detached git worktree, works there, runs
the verify command, opens the dev URL, and returns a patch plus screenshots.
The live tree is untouched until a human applies the patch.

**Scoping the roots is a real security decision.** A dev-task's shell can
read anything under a root, not only the board's folder, so a home-directory
root reaches `~/.ssh` and `~/.pi/auth.json`. The worktree sandbox constrains
where _edits_ land, not what a shell command can read. Listing the specific
repos you drive from Kr8Kan is the safer shape.

## Browser verification

`KR8KAN_BROWSER_ENABLED=true` plus a host in `KR8KAN_BROWSER_ALLOWED_HOSTS`
turns on the agent browser (`@kr8kan/browser`): headless Chrome driven over
CDP, using a system Chrome or Chromium — nothing is downloaded.

What it buys, once a board has a Dev URL:

- after the verify command passes, the **runner** — not the model — opens
  the page, captures desktop and mobile screenshots, and reads the console
- console errors flip `verifyStatus` to `fail` even when the command exited
  0, which feeds the existing `job.verify_failed` sentinel trigger
- screenshots hang off the job (`browserArtifacts`) and render beside the
  diff, so a human approving a CSS patch is looking at pixels
- workflows gain `checkUrl` and `captureScreenshot` steps; a `schedule`
  trigger plus either one is uptime or visual-regression monitoring

Rails, all deny-by-default:

- off entirely unless `KR8KAN_BROWSER_ENABLED=true`, and reachable nowhere
  unless a host is allowlisted; an entry with no port matches any port
- navigation is checked on the **destination**, and the host is resolved
  before the check, so an allowlisted domain cannot resolve to a private,
  loopback or link-local address — cloud metadata included
- only `http` and `https`; `file://` is refused
- there is no `eval` command, and selectors cross as bound arguments rather
  than interpolated source
- gated actions (`confirm` rules) park until a human answers through
  `agent.browserConfirm`; unanswered requests time out **denied**, and
  ending a session denies whatever is still parked
- page text that reaches a model — card-link fetches — is masked for secrets
  and fenced as untrusted data, carrying the same warning `injection.ts`
  uses. Screenshots and console captures taken by the runner are artifacts
  for a human, and are masked only when a `mask` rule matches.

Artifacts are written under the job dir, not S3 — server-side S3 upload is
not wired, and this works with no object storage configured.
