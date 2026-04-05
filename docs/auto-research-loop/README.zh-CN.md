# ClawLab

<p align="center">
  <a href="./README.en.md">
    <img alt="English" src="https://img.shields.io/badge/Language-English-0A66C2?style=for-the-badge">
  </a>
  <a href="./README.zh-CN.md">
    <img alt="中文" src="https://img.shields.io/badge/Language-Chinese-1F883D?style=for-the-badge">
  </a>
</p>

## 概览

ClawLab 是一个构建在 Claude Code CLI 源码快照之上的、可持续、可恢复、可中断的 Auto Research Loop 系统。

它面向两类起点场景：

1. `new_project`：从一个 topic 或 idea 出发，从零启动科研流程。
2. `existing_project_improvement`：基于已有仓库和明确瓶颈，自动做增量改进。

默认行为是：

- 持续执行 research rounds
- 持续写入结构化 artifacts
- 每轮都生成汇报
- 汇报后继续下一轮
- 只有用户明确要求时才生成最终 summary/report/paper

## 这是 Claude Code CLI 吗？

是的，在架构层面就是。

ClawLab 实现在本仓库内，以 Claude Code CLI 的命令与运行时架构为基础。项目新增了 `clawlab` 二进制别名，同时保留 `claude` 兼容路径。

这意味着 ClawLab 可以复用：

- 现有 CLI 交互体验
- 现有 `/login` OAuth 流程
- 仓库已有命令基础设施
- 仓库已有认证与会话处理机制

## 三层结构

### 第 1 层：Harness

负责：

- tool registry
- permission engine
- task runtime
- state machine
- memory store
- trace logging
- artifact store
- model router
- MCP integration placeholder

### 第 2 层：Auto Research Loop Engine

负责：

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

### 第 3 层：最终总结 / 写作引擎

仅在用户明确要求以下产出时运行：

- summary
- final report
- paper draft

## 状态模型

顶层状态：

- `IDLE`
- `MISSION_FRAMING`
- `RESEARCH_LOOP`
- `REPORTING`
- `WAITING_FOR_RESOURCES`
- `PAUSED`
- `READY_FOR_SUMMARIZATION`
- `FINAL_SUMMARIZATION`
- `ARCHIVED`

科研子状态：

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

常规路径：

`MISSION_FRAMING -> RESEARCH_LOOP -> REPORTING -> RESEARCH_LOOP`

汇报用于过程透明，而不是停止执行。

## 标准轮次纪律

每次严肃实验都应遵循：

1. patch
2. static check
3. smoke run
4. short run
5. full run
6. analysis

ClawLab 不会把 full run 当作第一步验证。

## 使用模式 A：从 Topic 启动

当你希望 ClawLab 从零启动科研流程时使用：

```bash
/research start --mode new "test-time adaptation for multimodal agents"
```

## 使用模式 B：改进现有项目

当已有真实仓库，并希望围绕明确问题做改进时使用。

典型场景：

- validation accuracy 卡住
- F1 不再提升
- reward model 出现平台期
- 训练不稳定
- 评估结果可疑
- 最近 patch 引入回归

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

在改进模式下，如果未提供 topic，命令会根据 problem 或 target metric 自动推导。

## 模型连接

ClawLab 提供研究层模型路由，支持以下 provider：

- `auto`
- `stub`
- `anthropic_oauth`
- `anthropic_api_key`
- `openai_compatible`

`auto` 会按顺序尝试：

1. 当前 Claude CLI OAuth 会话
2. Anthropic API key
3. stub 回退

只要你的模型端点提供 OpenAI-compatible `/chat/completions` API，就可以接入。这覆盖了 OpenAI、OpenRouter、vLLM、LM Studio 以及自托管兼容网关等常见场景。

### 支持的参数

- `--model-provider <auto|stub|anthropic-oauth|anthropic-api-key|openai-compatible>`
- `--model <model-name>`
- `--task-model <research|code|report|summary>=<model-name>`
- `--model-base-url <url>`
- `--model-api-key-env <ENV_VAR>`
- `--model-display-name <friendly-name>`

### Anthropic OAuth 示例

先启动 CLI 并执行：

```bash
/login
```

然后：

```bash
/research start \
  --mode new \
  --model-provider anthropic-oauth \
  --model claude-sonnet-4-6 \
  "browser-agent planning under noisy observations"
```

### Anthropic API key 示例

```bash
export ANTHROPIC_API_KEY=...
/research start --mode new --model-provider anthropic-api-key --model claude-sonnet-4-6 "multimodal routing"
```

### OpenAI-compatible 示例

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

### JSON 配置示例

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

## OAuth 登录

ClawLab 通过复用现有 Claude Code CLI 登录流程来支持 OAuth。

这也是 `anthropic_oauth` 的推荐路径：

1. 启动 `clawlab` 或 `claude`
2. 执行 `/login`
3. 完成 OAuth 流程
4. 执行 `/research ... --model-provider anthropic-oauth`

这样可以保持认证路径统一，避免在 research session artifacts 内存储额外 token。

## SSH / 远程 GPU 工作流

远程执行是一等后端能力。

ClawLab 支持：

- SSH key 登录
- password 登录
- 远程 workspace 路径
- conda 或 venv 环境选择
- `CUDA_VISIBLE_DEVICES`
- 后台任务
- 日志流
- 状态轮询
- artifact 收集

执行器层抽象了：

- local execution
- SSH execution

这让你可以先规划一次运行，再在 loop 中按需选择本地或远程执行目标。

## 命令

### Setup

```bash
/research setup [--force]
```

会创建阶段化脚手架（`paper/`、`experiment/`、`survey/`、`ideation/`、`promotion/`、`skills/`）以及 `.clawlab/` 共享状态文件，设计灵感来自结构化研究插件。

使用 `--force` 可以覆盖已有模板文件。

### Team

```bash
/research team <subcommand>
```

子命令：

- `init [--force]`：初始化 team 配置、team 状态和内置 skills catalog
- `status`：显示当前 stage、当前角色和下一步建议命令
- `roles`：列出默认 agent team 角色及其记忆范围
- `switch <role>`：切换当前角色（`conductor`、`literature_scout`、`experiment_driver`、`paper_writer`、`reviewer`）
- `skills [role] [--stage <stage>] [--category <name>]`：查询内置 research skills
- `help`：输出 team 命令帮助

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

这是进入最终总结与写作阶段的显式开关。

### Archive

```bash
/research archive [sessionId]
```

## Team 记忆与技能

Team 模式会把编排状态持久化到 `.clawlab/`：

- `.clawlab/team/team-config.json`
- `.clawlab/team/team-state.json`
- `.clawlab/skills/catalog.json`
- `.clawlab/tasks/tasks.json`
- `.clawlab/docs/research_brief.json`

核心 team 记忆文件：

- `.clawlab/memory/project_truth.md`
- `.clawlab/memory/orchestrator_state.md`
- `.clawlab/memory/execution_context.md`
- `.clawlab/memory/literature_bank.md`
- `.clawlab/memory/experiment_ledger.md`
- `.clawlab/memory/result_summary.md`
- `.clawlab/memory/review_log.md`
- `.clawlab/memory/agent_handoff.md`
- `.clawlab/memory/decision_log.md`

内置 skill catalog 当前包含 40 个 research skills，覆盖：

- literature
- ideation
- experiment
- engineering
- writing
- review
- ops
- planning

## 验证

如果你希望聚焦验证 ClawLab 新研究循环代码，而不被仓库中其他历史问题干扰，建议使用以下定向检查：

```bash
bun run lint:clawlab
bun run typecheck:clawlab
```

## Artifacts

每个 session 会把持久化输出写入：

```text
workspace/sessions/<sessionId>/
```

重要目录：

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

重要文件：

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

## 每轮汇报格式

每轮汇报都是标准 research round report，固定 11 个部分：

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

execution environment 包含：

- local or remote
- remote host（如适用）
- GPU allocation
- environment name
- working directory

## 示例

- 新课题示例：[examples/new-project.json](./examples/new-project.json)
- 现有项目改进示例：[examples/improve-existing-project.json](./examples/improve-existing-project.json)

## 先行工作启发

ClawLab 的设计吸收了现代 auto-research 系统中反复验证有效的模式：

- 显式的阶段化循环
- 持久化 artifact 存储
- 反思与重规划
- 长实验前的执行纪律
- 把远程执行视为常规路径而非补充方案
