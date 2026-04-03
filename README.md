# ClawLab

<p align="center">
  <a href="./docs/auto-research-loop/README.en.md">
    <img alt="Read in English" src="https://img.shields.io/badge/Read-English-0A66C2?style=for-the-badge">
  </a>
  <a href="./docs/auto-research-loop/README.zh-CN.md">
    <img alt="阅读中文" src="https://img.shields.io/badge/%E9%98%85%E8%AF%BB-%E4%B8%AD%E6%96%87-1F883D?style=for-the-badge">
  </a>
</p>

<p align="center">
  <strong>ClawLab</strong> is a persistent Auto Research Loop system built on top of a Claude Code CLI source snapshot.
</p>

![ClawLab CLI demo](./docs/auto-research-loop/assets/clawlab-cli-demo.svg)

## What ClawLab Is

ClawLab is not a one-shot deep research chatbot.

ClawLab is not a system that writes a paper every round.

ClawLab is a looped research harness that keeps doing this until a stop condition is reached:

1. frame the mission
2. research papers, repos, baselines, and failure modes
3. form hypotheses
4. create branch-isolated worktrees
5. patch code
6. validate before experiments
7. run experiments locally or on remote SSH GPU machines
8. debug, reflect, report, and continue automatically

The default behavior is:

- do research rounds
- generate structured artifacts
- write a round report every round
- continue automatically after reporting
- only enter summary/report/paper mode after explicit user approval

## Does It Use Claude Code CLI?

Yes.

ClawLab is implemented inside this repository and uses the Claude Code CLI command/runtime structure as its foundation. The new `clawlab` binary is a branded alias for the same CLI entrypoint, and the existing `claude` binary is kept for compatibility.

That means:

- the interactive shell experience is still Claude Code style
- ClawLab can reuse the existing `/login` OAuth flow
- ClawLab can coexist with the repo's existing commands, auth, and tooling

## Two Starting Modes

### 1. Start from a topic or idea

Use this when the user gives a topic and wants the system to build the research effort from scratch.

```bash
/research start --mode new "test-time adaptation for multimodal agents"
```

### 2. Improve an existing project

Use this when the user already has a repo and wants ClawLab to improve it automatically around a concrete bottleneck.

Typical cases:

- a metric plateaus
- training is unstable
- eval is suspicious
- a regression appeared
- the pipeline works but results no longer improve

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

## Model Connection

ClawLab now supports first-class research-layer model connections.

Supported providers:

- `auto`: reuse Claude CLI OAuth if available, otherwise try Anthropic API key, otherwise fall back to stub mode
- `anthropic_oauth`: use the existing Claude/Anthropic OAuth session from the CLI
- `anthropic_api_key`: use an Anthropic API key from an environment variable
- `openai_compatible`: use any OpenAI-compatible `/chat/completions` endpoint
- `stub`: deterministic fallback with no live model calls

This also covers user-owned model stacks behind OpenAI-compatible gateways such as OpenAI, OpenRouter, vLLM, LM Studio, or self-hosted routing services.

Supported model flags on `/research start`:

- `--model-provider <auto|stub|anthropic-oauth|anthropic-api-key|openai-compatible>`
- `--model <model-name>`
- `--task-model <research|code|report|summary>=<model-name>`
- `--model-base-url <url>`
- `--model-api-key-env <ENV_VAR>`
- `--model-display-name <friendly-name>`

### Example: Reuse Claude CLI OAuth

Start the CLI, run `/login`, then launch research with:

```bash
/research start \
  --mode new \
  --model-provider anthropic-oauth \
  --model claude-sonnet-4-6 \
  "robust planning for browser agents"
```

### Example: OpenAI-compatible backend

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

### Example JSON config

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

ClawLab does support OAuth sign-in, but it does it the pragmatic way: it reuses the existing Claude Code CLI login flow instead of inventing a separate auth stack.

Workflow:

1. launch `clawlab` or `claude`
2. run `/login`
3. finish the Claude/Anthropic OAuth flow
4. start `/research ... --model-provider anthropic-oauth`

This makes the research loop work naturally inside the same CLI session and avoids duplicating credentials in ClawLab session artifacts.

## Remote GPU / SSH Execution

Remote SSH execution is a first-class backend.

ClawLab supports:

- SSH key login
- password login
- remote workspace selection
- conda or venv environment selection
- `CUDA_VISIBLE_DEVICES`
- foreground short runs
- background full runs
- log streaming
- status checks
- artifact collection

The execution layer is abstracted through local and SSH executors, so local and remote experiment flows share the same high-level planning interface.

## Research Artifacts

Each session writes durable artifacts under:

```text
workspace/sessions/<sessionId>/
```

Key outputs include:

- `mission/mission.md`
- `mission/success_criteria.json`
- `mission/budget.json`
- `mission/improvement_brief.json`
- `mission/safety_checklist.json`
- `mission/model_connection.json`
- `sources/sources.jsonl`
- `evidence/evidence_bank.jsonl`
- `results/hypotheses.jsonl`
- `results/patch_plan.json`
- `results/validation_plan.json`
- `results/execution_target.json`
- `results/research_index.json`
- `reports/research_index.md`
- `reports/round_XXX.md`

## Round Report Format

Each round writes a research round report with exactly 11 sections:

1. round objective
2. research findings
3. new evidence
4. code changes
5. experiments
6. key results
7. failures and fixes
8. current best-so-far
9. current uncertainties
10. next-round plan
11. execution environment

The normal path is:

`REPORTING -> RESEARCH_LOOP`

ClawLab reports for transparency, not for stopping.

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Start the CLI

```bash
bun src/entrypoints/cli.tsx
```

If you package it or install it globally, you can use:

```bash
clawlab
```

### 3. Login if you want OAuth-backed model access

Inside the CLI:

```bash
/login
```

### 4. Start a research mission

Inside the CLI:

```bash
/research start --mode new "adaptive planning for browser agents"
```

## Validation

Use the focused ClawLab checks when you want signal on the new research-loop code without getting buried by unrelated legacy issues elsewhere in the repo:

```bash
bun run lint:clawlab
bun run typecheck:clawlab
```

## Documentation

- English guide: [docs/auto-research-loop/README.en.md](./docs/auto-research-loop/README.en.md)
- 中文指南: [docs/auto-research-loop/README.zh-CN.md](./docs/auto-research-loop/README.zh-CN.md)
- Guide landing page: [docs/auto-research-loop/README.md](./docs/auto-research-loop/README.md)
- New project example: [docs/auto-research-loop/examples/new-project.json](./docs/auto-research-loop/examples/new-project.json)
- Existing-project improvement example: [docs/auto-research-loop/examples/improve-existing-project.json](./docs/auto-research-loop/examples/improve-existing-project.json)

## Design Notes

ClawLab takes inspiration from the broader auto-research ecosystem, especially projects that emphasize staged workflows, persistent artifacts, execution discipline, and explicit reflection loops. The goal here is not to clone those systems, but to fold the strongest patterns into a repo-aware, branch-isolated, SSH-capable research harness.

Representative references:

- [awesome-autoresearch](https://github.com/zhimin-z/awesome-autoresearch)
- [AI Scientist](https://github.com/SakanaAI/AI-Scientist)
- [AgentLaboratory](https://github.com/SamuelSchmidgall/AgentLaboratory)
- [Open Deep Research](https://github.com/langchain-ai/open_deep_research)
- [Scientify](https://github.com/tsingyuai/scientify)
