# ClawLab Guide

## What this guide covers

This guide is the practical usage manual for the current ClawLab implementation.

It focuses on:

- what is already runnable
- how to start research missions
- how to wire native integrations
- how to use the rebuttal pipeline
- how to use executable local skills
- how to verify changes honestly

## Current stable command surface

### Research loop

```bash
/research setup
/research start --mode new "topic"
/research start --mode improve --repo /path --problem "..."
/research status
/research pause
/research resume
/research summarize report
```

### Native integrations

```bash
/research integration status
/research integration doctor
/research integration doctor codex
/research integration init codex
/research integration init claude-code
/research integration init openclaw
```

### Rebuttal workflow

```bash
/research rebuttal init
/research rebuttal plan --paper paper.pdf --review review1.pdf --review review2.txt --repo /path/to/repo --venue neurips
/research rebuttal draft --run-dir /path/to/run
/research rebuttal validate --draft /path/to/rebuttal_draft.md --venue neurips
```

### Executable skills

```bash
/research skills list
/research skills show integration-doctor
/research skills run integration-doctor
/research skills run review-concern-extract --review review.pdf
```

## Step-by-step

### 1. Install and launch

```bash
bun install
bun src/entrypoints/cli.tsx
```

Optional:

```bash
/login
```

Use `/login` only if you want Anthropic OAuth-backed model routing.

### 2. Initialize the local workspace

```bash
/research setup
```

This creates the `.clawlab/` workspace used by:

- task tracking
- integration templates
- rebuttal runs
- skill run artifacts
- memory files

### 3. Choose your main path

#### Path A: research from a topic

```bash
/research start --mode new "robust planning for browser agents"
```

#### Path B: improve an existing project

```bash
/research start \
  --mode improve \
  --repo /workspace/ranker \
  --problem "NDCG@10 plateaued at 0.488" \
  --target-metric ndcg_at_10 \
  --current-metric ndcg_at_10=0.488 \
  --goal "reach 0.51+ without major latency regression"
```

#### Path C: rebuttal work

Use this when you already have a paper/draft plus reviewer comments.

```bash
/research rebuttal plan \
  --paper /workspace/paper.pdf \
  --review /workspace/review1.pdf \
  --review /workspace/review2.txt \
  --repo /workspace/project \
  --venue cvpr
```

Then:

```bash
/research rebuttal draft --run-dir /workspace/.clawlab/rebuttal/runs/run_...
/research rebuttal validate --draft /workspace/.clawlab/rebuttal/runs/run_.../rebuttal_draft.md --venue cvpr
```

## Native integration details

ClawLab currently treats Codex, Claude Code, and OpenClaw as **native integration targets**, not as vague marketing labels.

### Codex integration

What ClawLab can do now:

- detect `codex` on `PATH`
- detect `~/.codex/config.toml`
- detect `~/.codex/auth.json` or `OPENAI_API_KEY`
- generate `.codex/AGENTS.md`
- generate `.codex/config.toml`

### Claude Code integration

What ClawLab can do now:

- detect `claude` on `PATH`
- detect `~/.claude/settings.json` or `~/.claude/settings.local.json`
- generate `.claude/agents/clawlab-research.md`
- generate `.claude/settings.local.json`

Important limitation:

- ClawLab does **not** claim that a valid interactive Claude login exists from static file checks alone.

### OpenClaw integration

What ClawLab can do now:

- detect `openclaw` on `PATH`
- detect `~/.openclaw/openclaw.json`
- inspect auth/profile hints in config
- generate `.openclaw/clawlab.project.json5`
- generate `.openclaw/README.md`

## Rebuttal pipeline details

### Inputs

- a manuscript PDF or text file
- one or more review PDFs or text files
- an optional local repo path
- a venue preset

### Outputs

Per run, ClawLab writes:

- extracted paper text
- extracted review text
- concern map
- venue policy snapshot
- repo evidence map
- rebuttal plan
- rebuttal draft
- validation report

### Venue presets

Built-in presets:

- `cvpr`
- `neurips`
- `iclr`
- `acl_arr`
- `generic`

Current policy handling includes:

- character limits
- word limits
- approximate page limits
- link restrictions
- anonymity expectations
- venue notes

### Drafting behavior

ClawLab first tries a model-assisted draft through the current auto model router.

If no live model connection is available, it falls back to a deterministic, evidence-aware template draft.

That means the workflow is still runnable even without live model auth, but the draft quality will depend on what model access is actually configured.

## Executable local skills

Current built-ins:

- `integration-doctor`
- `review-concern-extract`
- `venue-policy-check`
- `repo-evidence-scan`
- `rebuttal-plan`

These are local and executable.

They are intentionally separate from external references such as:

- Paper2Rebuttal
- ClawHub Research Library
- ClawHub OpenReview Review Analyzer
- ClawHub Code Auditor

Those external projects are useful references, but ClawLab does not pretend they are bundled local skills.

## Team note

`/research team ...` currently provides:

- role scaffolding
- role memory templates
- role switches
- role-oriented playbook suggestions

It does **not** mean the repository already embeds the full OMX durable team runtime.

## Verification

Use:

```bash
bun run lint:clawlab
bun run test:clawlab
bun run check:clawlab
```

Current verified status for this implementation work:

- focused ClawLab tests pass
- focused ClawLab lint passes with complexity warnings only

The repo-wide TypeScript baseline still contains many unrelated upstream issues, so treat focused tests and focused lint as the honest verification gate for now.
