# ClawLab

<p align="center">
  <a href="./README.en.md">
    <img alt="English" src="https://img.shields.io/badge/Language-English-0A66C2?style=for-the-badge">
  </a>
  <a href="./README.zh-CN.md">
    <img alt="中文" src="https://img.shields.io/badge/Language-Chinese-1F883D?style=for-the-badge">
  </a>
</p>

## Overview

ClawLab is a persistent, resumable, interruptible Auto Research Loop system built on top of a Claude Code CLI source snapshot.

It is designed for two kinds of starting points:

1. `new_project`: start from a topic or idea and build the research effort from scratch.
2. `existing_project_improvement`: take an existing repository plus a concrete bottleneck and improve it automatically.

The default behavior is:

- keep doing research rounds
- keep writing structured artifacts
- keep reporting every round
- keep continuing after reporting
- do not write the final summary/report/paper until the user explicitly asks

## Is this Claude Code CLI?

Yes, structurally.

ClawLab is implemented inside this repo and uses the Claude Code CLI command/runtime architecture as its base. The project now exposes a `clawlab` binary alias while preserving the existing `claude` compatibility path.

That means ClawLab can reuse:

- the existing CLI UX
- the existing `/login` OAuth flow
- the repo's command infrastructure
- the repo's auth/session handling

## Three Layers

### Layer 1. Harness

Responsible for:

- tool registry
- permission engine
- task runtime
- state machine
- memory store
- trace logging
- artifact store
- model router
- MCP integration placeholder

### Layer 2. Auto Research Loop Engine

Responsible for:

- mission framing
- literature and repo reconnaissance
- hypothesis generation
- branch selection
- patch planning
- code editing
- validation
- experiment execution
- debugging
- reflection
- replanning

### Layer 3. Final Summarize / Writeup Engine

Only runs when the user explicitly asks for:

- summary
- final report
- paper draft

## State Model

Top-level states:

- `IDLE`
- `MISSION_FRAMING`
- `RESEARCH_LOOP`
- `REPORTING`
- `WAITING_FOR_RESOURCES`
- `PAUSED`
- `READY_FOR_SUMMARIZATION`
- `FINAL_SUMMARIZATION`
- `ARCHIVED`

Research states:

- `RESEARCHING`
- `FORMING_HYPOTHESES`
- `BRANCH_SELECTION`
- `PLANNING_PATCH`
- `PATCHING`
- `VALIDATING`
- `RUNNING_EXPERIMENT`
- `DEBUGGING`
- `REFLECTING`
- `RESEARCH_ROUND_DONE`

The normal path is:

`MISSION_FRAMING -> RESEARCH_LOOP -> REPORTING -> RESEARCH_LOOP`

Reporting is for transparency, not for stopping.

## Standard Round Discipline

Every serious run is expected to follow:

1. patch
2. static check
3. smoke run
4. short run
5. full run
6. analysis

ClawLab does not treat full runs as the first validation step.

## Usage Mode A: Start From a Topic

Use this when you want ClawLab to bootstrap the research effort from scratch.

```bash
/research start --mode new "test-time adaptation for multimodal agents"
```

## Usage Mode B: Improve an Existing Project

Use this when a real repo already exists and you want ClawLab to improve it around a concrete problem.

Typical cases:

- validation accuracy is stuck
- F1 no longer improves
- reward model plateaus
- training is unstable
- evaluation looks suspicious
- a recent patch introduced regression

```bash
/research start \
  --mode improve \
  --repo /path/to/project \
  --problem "validation F1 is stuck around 0.72 after epoch 3" \
  --target-metric f1 \
  --current-metric f1=0.72 \
  --goal "push F1 beyond 0.76 without a large inference-cost regression" \
  --focus-file src/train.py \
  --focus-file configs/train.json
```

If no topic is supplied in improvement mode, the command derives one from the problem or target metric.

## Model Connection

ClawLab includes a research-layer model router with these providers:

- `auto`
- `stub`
- `anthropic_oauth`
- `anthropic_api_key`
- `openai_compatible`

`auto` tries:

1. the current Claude CLI OAuth session
2. an Anthropic API key
3. stub fallback

You can also connect your own model endpoint as long as it exposes an OpenAI-compatible `/chat/completions` API. That covers common setups such as OpenAI, OpenRouter, vLLM, LM Studio, and self-hosted gateways.

### Supported flags

- `--model-provider <auto|stub|anthropic-oauth|anthropic-api-key|openai-compatible>`
- `--model <model-name>`
- `--task-model <research|code|report|summary>=<model-name>`
- `--model-base-url <url>`
- `--model-api-key-env <ENV_VAR>`
- `--model-display-name <friendly-name>`

### Anthropic OAuth example

First, start the CLI and run:

```bash
/login
```

Then:

```bash
/research start \
  --mode new \
  --model-provider anthropic-oauth \
  --model claude-sonnet-4-6 \
  "browser-agent planning under noisy observations"
```

### Anthropic API key example

```bash
export ANTHROPIC_API_KEY=...
/research start --mode new --model-provider anthropic-api-key --model claude-sonnet-4-6 "multimodal routing"
```

### OpenAI-compatible example

```bash
/research start \
  --mode improve \
  --repo /workspace/ranker \
  --problem "NDCG@10 plateaued" \
  --model-provider openai-compatible \
  --model gpt-4.1-mini \
  --model-base-url https://api.openai.com/v1 \
  --model-api-key-env OPENAI_API_KEY
```

### JSON config example

```json
{
  "topic": "improve the existing ranking model",
  "missionType": "existing_project_improvement",
  "repoPath": "/workspace/ranker",
  "problemStatement": "NDCG@10 has plateaued at 0.488 for the last 5 runs",
  "targetMetric": "ndcg_at_10",
  "currentMetricsSnapshot": { "ndcg_at_10": 0.488, "latency_ms": 82.4 },
  "improvementGoal": "reach 0.51+ NDCG@10 without major latency regression",
  "preferredFocusFiles": ["src/train.py", "src/losses.py", "configs/base.json"],
  "modelConnection": {
    "provider": "openai_compatible",
    "model": "gpt-4.1-mini",
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnvVar": "OPENAI_API_KEY",
    "taskModels": {
      "research": "gpt-4.1-mini",
      "summary": "gpt-4.1"
    }
  }
}
```

## OAuth Sign-In

ClawLab supports OAuth sign-in by reusing the existing Claude Code CLI login flow.

This is the intended path for `anthropic_oauth`:

1. start `clawlab` or `claude`
2. run `/login`
3. complete the OAuth flow
4. run `/research ... --model-provider anthropic-oauth`

This keeps auth unified and avoids storing extra tokens inside research session artifacts.

## SSH / Remote GPU Workflow

Remote execution is a first-class backend.

ClawLab supports:

- SSH key login
- password login
- remote workspace path
- conda or venv environment selection
- `CUDA_VISIBLE_DEVICES`
- background jobs
- log streaming
- status polling
- artifact collection

The executor layer abstracts:

- local execution
- SSH execution

This makes it possible to plan a run once and choose local or remote targets later in the loop.

## Commands

### Setup

```bash
/research setup [--force]
```

Creates a stage-oriented scaffold (`paper/`, `experiment/`, `survey/`, `ideation/`, `promotion/`, `skills/`) and `.clawlab/` shared state files inspired by structured research plugins.

Use `--force` to overwrite existing scaffold template files.

### Team

```bash
/research team <subcommand>
```

Subcommands:

- `init [--force]`: initialize team config, team state, and built-in skill catalog
- `status`: show active stage, active role, and next commands
- `roles`: list default agent team roles and role memory scopes
- `switch <role>`: switch active role (`conductor`, `literature_scout`, `experiment_driver`, `paper_writer`, `reviewer`)
- `skills [role] [--stage <stage>] [--category <name>]`: query built-in research skills
- `help`: print team command help

### Start

```bash
/research start [flags] [topic]
```

### Resume

```bash
/research resume [sessionId]
```

### Pause

```bash
/research pause [sessionId]
```

### Status

```bash
/research status [sessionId]
```

### Summarize

```bash
/research summarize [sessionId] [summary|report|paper]
```

This is the explicit opt-in switch for final summarization and writing.

### Archive

```bash
/research archive [sessionId]
```

## Team Memory and Skills

Team mode persists orchestration state under `.clawlab/`:

- `.clawlab/team/team-config.json`
- `.clawlab/team/team-state.json`
- `.clawlab/skills/catalog.json`
- `.clawlab/tasks/tasks.json`
- `.clawlab/docs/research_brief.json`

Core team memory files:

- `.clawlab/memory/project_truth.md`
- `.clawlab/memory/orchestrator_state.md`
- `.clawlab/memory/execution_context.md`
- `.clawlab/memory/literature_bank.md`
- `.clawlab/memory/experiment_ledger.md`
- `.clawlab/memory/result_summary.md`
- `.clawlab/memory/review_log.md`
- `.clawlab/memory/agent_handoff.md`
- `.clawlab/memory/decision_log.md`

Built-in skill catalog includes 40 research skills across:

- literature
- ideation
- experiment
- engineering
- writing
- review
- ops
- planning

## Validation

Use the focused ClawLab checks when you want signal on the new research-loop code without getting buried by unrelated legacy issues elsewhere in the repo:

```bash
bun run lint:clawlab
bun run typecheck:clawlab
```

## Artifacts

Each session writes durable outputs under:

```text
workspace/sessions/<sessionId>/
```

Important directories:

- `mission/`
- `sources/`
- `evidence/`
- `branches/`
- `patches/`
- `runs/`
- `results/`
- `reports/`
- `summaries/`
- `memory/`
- `remote/`

Important files:

- `mission/mission.md`
- `mission/success_criteria.json`
- `mission/budget.json`
- `mission/improvement_brief.json`
- `mission/safety_checklist.json`
- `mission/model_connection.json`
- `results/hypotheses.jsonl`
- `results/patch_plan.json`
- `results/validation_plan.json`
- `results/execution_target.json`
- `results/research_index.json`
- `reports/research_index.md`

## Round Report Format

Each round report is a research round report with exactly 11 sections:

1. objective
2. research findings
3. new evidence
4. code changes
5. experiments
6. key results
7. failures and fixes
8. current best-so-far
9. uncertainties
10. next-round plan
11. execution environment

Execution environment includes:

- local or remote
- remote host if relevant
- GPU allocation
- environment name
- working directory

## Examples

- New project example: [examples/new-project.json](./examples/new-project.json)
- Existing project improvement example: [examples/improve-existing-project.json](./examples/improve-existing-project.json)

## Notes on Prior Art

ClawLab was shaped by recurring patterns seen in modern auto-research systems:

- explicit staged loops
- persistent artifact stores
- reflection and replanning
- execution discipline before long runs
- remote execution as a normal path rather than an afterthought
