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

| Env | Default | Meaning |
|---|---|---|
| `KR8KAN_PI_MAX_CONCURRENT` | 4 | Global concurrent pi processes; excess jobs queue as `pending` (in-process FIFO) |
| `KR8KAN_PI_MAX_CONCURRENT_TOOLS` | 1 | Lower lane for tool-enabled (dev-task) runs |
| `KR8KAN_PI_MAX_PER_USER` | 3 | Per-user concurrent (pending+running) jobs |
| `KR8KAN_PI_MAX_PER_HOUR` | 30 | Per-user runs per hour |
| `KR8KAN_PI_TOOL_TIMEOUT_MS` | 900000 | Wall clock for tools runs (also the verify-command budget) |

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
