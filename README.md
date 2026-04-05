<p align="center">
  <img alt="ClawLab Logo" src="./docs/auto-research-loop/assets/clawlab.png" width="220">
</p>

<h1 align="center">ClawLab</h1>

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

## What ClawLab Is

ClawLab is a looped research harness for real project work, not a one-shot chatbot.

It keeps running: mission framing -> evidence -> hypothesis -> patch -> validate -> experiment -> reflect -> report, until stop criteria are met.

## Mode-First Overview

Start by choosing a mode.

Built-in skill catalog size: **57** skills.

| Mode | When to use | Primary entry | Built-in skills (mode bundle) |
| --- | --- | --- | --- |
| New Project Mode | You only have an idea/topic | `/research start --mode new ...` | 17 |
| Project Improvement Mode | You already have a repo and bottleneck | `/research start --mode improve ...` | 18 |
| Paper Writing Mode | You explicitly want summary/report/paper drafting | `/research summarize paper [sessionId]` | 13 |
| Rebuttal Mode | You have draft/paper + reviewer comments | Rebuttal workflow over existing project mode | 15 |

Notes:

- Mode bundle counts can overlap; one skill can serve multiple modes.
- Team orchestration remains the same: `team-plan -> team-prd -> team-exec -> team-verify -> team-fix`.

## Install And Start

### 1) Install dependencies

```bash
bun install
```

### 2) Start CLI

```bash
bun src/entrypoints/cli.tsx
```

Or use packaged binary:

```bash
clawlab
```

### 3) Optional OAuth login (for Anthropic OAuth provider)

Inside CLI:

```bash
/login
```

### 4) Initialize workspace scaffold

Inside CLI:

```bash
/research setup
```

If you want to overwrite template files:

```bash
/research setup --force
```

### 5) Initialize and inspect Team state

```bash
/research team init
/research team status
/research team roles
```

## SSH Connection Quick Setup

Use a mission config JSON with `remoteMachines`.

```json
{
  "topic": "improve retrieval quality",
  "missionType": "existing_project_improvement",
  "repoPath": "/workspace/retriever",
  "problemStatement": "NDCG@10 plateaued at 0.488",
  "targetMetric": "ndcg_at_10",
  "remoteMachines": [
    {
      "id": "gpu-a100-01",
      "host": "10.0.0.12",
      "port": 22,
      "username": "ubuntu",
      "authType": "ssh_key",
      "sshKeyPath": "~/.ssh/id_ed25519",
      "remoteWorkspace": "/data/projects/retriever",
      "pythonEnvType": "conda",
      "pythonEnvName": "retriever"
    }
  ]
}
```

Run with config:

```bash
/research start --config ./mission.improve.ssh.json
```

Supported SSH patterns:

- SSH key login
- Password login (`authType: "password"` + `password`)
- Remote workspace selection (`remoteWorkspace`)
- Python env selection (`pythonEnvType`, `pythonEnvName`)
- GPU-aware execution targets via execution planning

## Use Modes After Installation

### New Project Mode

Use when:

- you start from topic/idea only
- there is no concrete repo bottleneck yet

Command:

```bash
/research start --mode new "test-time adaptation for multimodal agents"
```

Mode bundle skills (17):

- paper-finder
- paper-analyzer
- citation-graph-builder
- dataset-discovery
- benchmark-discovery
- repo-scout
- hypothesis-generator
- novelty-checker
- feasibility-scorer
- risk-mapper
- research-idea-convergence
- ablation-planner
- experiment-plan-author
- validation-pipeline-designer
- research-pipeline-planner
- task-prioritization
- decision-log-maintainer

### Project Improvement Mode

Use when:

- you already have a repo
- metrics stagnate / regress / become unstable

Command:

```bash
/research start \
  --mode improve \
  --repo /path/to/project \
  --problem "validation F1 stuck around 0.72" \
  --target-metric f1 \
  --current-metric f1=0.72 \
  --goal "push F1 beyond 0.76"
```

Mode bundle skills (18):

- repo-scout
- benchmark-discovery
- experiment-plan-author
- validation-pipeline-designer
- eval-harness-builder
- regression-debugger
- remote-experiment-operator
- gpu-budget-planner
- data-quality-auditor
- profiling-analysis
- memory-optimization
- patch-safety-review
- test-hardening
- statistical-sanity-check
- reproducibility-audit
- methodology-critic
- claim-consistency-review
- task-prioritization

### Paper Writing Mode

Only run when user explicitly asks to:

- summarize
- write a final report
- draft a paper
- organize results into a paper draft

Goal:

- use completed research artifacts to generate evidence-grounded writing output

Primary entry:

```bash
/research summarize paper [sessionId]
```

Inputs:

- mission / topic
- sources
- evidence bank
- runs / metrics
- figures / tables
- round reports
- best-so-far summary
- optional venue / style / page limit

Phases:

1. Summary Planning
2. Artifact Aggregation
3. Narrative Synthesis
4. Draft Generation
5. Final Output

If output = paper draft, generate:

- title candidates
- abstract
- introduction
- related work
- method
- experiments
- ablations / analysis
- limitations
- conclusion

Rules:

- do not invent experiments
- do not invent results
- separate verified findings from interpretation
- do not overclaim

Mode bundle skills (13):

- paper-outline
- title-generation
- abstract-polish
- related-work-synthesis
- method-writeup
- experiment-writeup
- limitation-writing
- figure-caption-writing
- paper-structure-planner
- scientific-writing
- result-summarizer
- reference-auditor
- claim-consistency-review

### Rebuttal Mode

Only run when user provides:

- paper / draft / PDF / LaTeX
- reviewer comments

Goal:

- support full rebuttal flow: paper + reviews -> analysis -> experiments if needed -> rebuttal draft

Recommended entry workflow:

1. Start from existing project mode with rebuttal concern as problem statement.
2. Switch to reviewer role and run concern decomposition + evidence mapping skills.
3. Run extra experiments only when concern typing marks evidence gaps.
4. Draft point-by-point response and revision plan.

Example command pattern:

```bash
/research start \
  --mode improve \
  --repo /path/to/project \
  --problem "Rebuttal round: reviewers requested stronger baselines and ablations"
```

Then inside the same session:

```bash
/research team switch reviewer
/research team skills --category review
/research summarize report [sessionId]
```

Phases:

1. Review Parse
2. Concern Decomposition
3. Concern Typing
4. Action Decision
5. Rebuttal Experiment Planning
6. Rebuttal Experiment Execution
7. Evidence Mapping
8. Rebuttal Drafting
9. Revision Plan Output

Concern types:

- misunderstanding
- missing explanation
- missing citation
- weak baseline
- weak ablation
- missing experiment
- statistical weakness
- writing clarity issue
- overclaiming
- limitation not acknowledged

Rules:

- answer concerns directly
- use evidence-grounded language
- do not claim fixes without evidence
- if new experiments are run, clearly state what was added and what changed
- if unresolved, acknowledge limitation honestly

Target outputs:

- parsed_reviews.json
- concern_items.json
- rebuttal_action_plan.json
- rebuttal_experiment_plan.json
- rebuttal_evidence_map.json
- rebuttal_draft.md
- point_by_point_response.md
- revision_plan.md

Mode bundle skills (15):

- review-parse
- concern-decompose
- concern-typing
- rebuttal-strategy
- rebuttal-experiment-gap
- rebuttal-evidence-mapping
- reviewer-response-writing
- point-by-point-response
- revision-plan-writing
- rebuttal-drafter
- experiment-plan-author
- validation-pipeline-designer
- statistical-sanity-check
- claim-consistency-review
- limitation-writing

## Team, Memory, Skills

Default team roles:

- conductor
- literature_scout
- experiment_driver
- paper_writer
- reviewer

Team command surface:

```bash
/research team init
/research team status
/research team roles
/research team switch reviewer
/research team skills --stage experiment
```

Durable state under `.clawlab/`:

- `.clawlab/tasks/tasks.json`
- `.clawlab/docs/research_brief.json`
- `.clawlab/team/team-config.json`
- `.clawlab/team/team-state.json`
- `.clawlab/skills/catalog.json`

Core memory files:

- `.clawlab/memory/project_truth.md`
- `.clawlab/memory/literature_bank.md`
- `.clawlab/memory/experiment_ledger.md`
- `.clawlab/memory/result_summary.md`
- `.clawlab/memory/review_log.md`
- `.clawlab/memory/agent_handoff.md`
- `.clawlab/memory/decision_log.md`
- `.clawlab/memory/orchestrator_state.md`
- `.clawlab/memory/execution_context.md`

## Model Connection

Supported providers:

- `auto`
- `anthropic_oauth`
- `anthropic_api_key`
- `openai_compatible`
- `stub`

Common flags on `/research start`:

- `--model-provider <auto|stub|anthropic-oauth|anthropic-api-key|openai-compatible>`
- `--model <model-name>`
- `--task-model <research|code|report|summary>=<model-name>`
- `--model-base-url <url>`
- `--model-api-key-env <ENV_VAR>`
- `--model-display-name <friendly-name>`

## Common Commands

```bash
/research setup [--force]
/research start [flags] [topic]
/research status [sessionId]
/research pause [sessionId]
/research resume [sessionId]
/research summarize [paper|report|summary] [sessionId]
/research archive [sessionId]
```

## Artifacts

Session outputs are written under:

```text
workspace/sessions/<sessionId>/
```

Key outputs include:

- `mission/mission.md`
- `mission/success_criteria.json`
- `mission/budget.json`
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

## Validation

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
