# ClawLab

<p align="center">
  <a href="./README.en.md">
    <img alt="English" src="https://img.shields.io/badge/Language-English-0A66C2?style=for-the-badge">
  </a>
  <a href="./README.zh-CN.md">
    <img alt="中文" src="https://img.shields.io/badge/Language-Chinese-1F883D?style=for-the-badge">
  </a>
</p>

![ClawLab CLI demo](./assets/clawlab-cli-demo.svg)

## 系统简介

ClawLab 是一个构建在 Claude Code CLI 源码快照之上的持续式 Auto Research Loop 系统。

它支持两种典型起点：

1. `new_project`
说明：用户只给一个 topic 或 idea，从零开始自动科研。
2. `existing_project_improvement`
说明：用户已经有一个现成项目，希望系统围绕具体问题自动改进，比如 metric 上不去、训练不稳定、eval 可疑、最近出现回归等。

默认行为是：

- 默认持续做 research rounds
- 默认持续写结构化 artifacts
- 默认每轮都向用户汇报
- 默认汇报后自动进入下一轮
- 只有用户明确要求时才进入 final summary / report / paper

## 这是不是 Claude Code CLI？

是的，底层架构上就是。

ClawLab 不是完全另起一套 CLI，而是接在这个仓库现有的 Claude Code CLI 结构之上。现在项目新增了 `clawlab` 这个品牌化入口，同时保留 `claude` 兼容入口。

这意味着：

- 交互体验仍然是 Claude Code 风格
- 可以直接复用现有 `/login` OAuth 登录流程
- 可以复用现有命令系统、会话系统和认证系统

## 三层架构

### 第一层：Harness

负责：

- tool registry
- permission engine
- task runtime
- state machine
- memory store
- trace logging
- artifact store
- model router
- MCP 接口占位

### 第二层：Auto Research Loop Engine

负责：

- mission framing
- literature / repo reconnaissance
- hypothesis generation
- branch selection
- patch planning
- code editing
- validation
- experiment execution
- debugging
- reflection
- replanning

### 第三层：Final Summarize / Writeup Engine

注意：

- 默认不运行
- 只有用户明确要求时才进入

## 状态机

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

科研状态：

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

正常路径是：

`MISSION_FRAMING -> RESEARCH_LOOP -> REPORTING -> RESEARCH_LOOP`

汇报的目的不是停下来等确认，而是让过程透明可见。

## 实验纪律

严肃实验必须按这个顺序走：

1. patch
2. static check
3. smoke run
4. short run
5. full run
6. analysis

ClawLab 不允许把 full run 当成第一步验证。

## 用法一：从 topic / idea 开始

适合：

- 你只有研究方向
- 你还没有稳定代码库
- 你希望系统自己去找 baseline、benchmark 和切入点

```bash
/research start --mode new "test-time adaptation for multimodal agents"
```

## 用法二：改进现有项目

这是这次重点增强的能力。

适合：

- 现有 repo 已经能训练或评测
- 某个指标卡住了
- 训练不稳定
- eval pipeline 可疑
- 最近出现 regression

```bash
/research start \
  --mode improve \
  --repo /path/to/project \
  --problem "validation F1 在 epoch 3 后卡在 0.72 左右" \
  --target-metric f1 \
  --current-metric f1=0.72 \
  --goal "在不过度增加推理成本的前提下把 F1 提到 0.76 以上" \
  --focus-file src/train.py \
  --focus-file configs/train.json
```

如果改进模式下没有单独提供 topic，系统会根据 `problem` 或 `target-metric` 自动生成。

## 用户如何接入自己的模型

ClawLab 现在支持研究层自己的模型路由，支持这些 provider：

- `auto`
- `stub`
- `anthropic_oauth`
- `anthropic_api_key`
- `openai_compatible`

`auto` 的行为是：

1. 优先复用当前 Claude CLI 的 OAuth 登录态
2. 没有 OAuth 时尝试 Anthropic API key
3. 都没有时退回 stub

如果你要接入自己的模型，只要它暴露的是 OpenAI-compatible 的 `/chat/completions` 接口，ClawLab 就可以接。常见场景包括 OpenAI、OpenRouter、vLLM、LM Studio，以及你自己托管的兼容网关。

### 支持的参数

- `--model-provider <auto|stub|anthropic-oauth|anthropic-api-key|openai-compatible>`
- `--model <model-name>`
- `--task-model <research|code|report|summary>=<model-name>`
- `--model-base-url <url>`
- `--model-api-key-env <ENV_VAR>`
- `--model-display-name <friendly-name>`

### 方式一：复用 Claude CLI 的 OAuth

先启动 CLI，在里面执行：

```bash
/login
```

然后：

```bash
/research start \
  --mode new \
  --model-provider anthropic-oauth \
  --model claude-sonnet-4-6 \
  "browser agent planning under noisy observations"
```

### 方式二：Anthropic API Key

```bash
export ANTHROPIC_API_KEY=...
/research start --mode new --model-provider anthropic-api-key --model claude-sonnet-4-6 "multimodal routing"
```

### 方式三：OpenAI-compatible 接口

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
  "problemStatement": "NDCG@10 连续 5 次实验停在 0.488",
  "targetMetric": "ndcg_at_10",
  "currentMetricsSnapshot": { "ndcg_at_10": 0.488, "latency_ms": 82.4 },
  "improvementGoal": "在没有明显延迟回归的前提下把 NDCG@10 提到 0.51+",
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

## 是否支持 OAuth Sign-In？

支持，但实现方式是“复用现有 Claude Code CLI 登录流程”，而不是另造一套账号系统。

`anthropic_oauth` 的标准流程：

1. 启动 `clawlab` 或 `claude`
2. 执行 `/login`
3. 完成 Claude / Anthropic OAuth 流程
4. 再执行 `/research ... --model-provider anthropic-oauth`

这样可以保证：

- 研究层直接复用 CLI 登录态
- 不额外复制 token
- session artifact 里不会平白落额外凭据

## 远程 SSH / GPU 工作流

远程执行是 ClawLab 的一等后端，不是补丁功能。

支持：

- SSH key 登录
- password 登录
- remote workspace
- conda / venv 环境
- `CUDA_VISIBLE_DEVICES`
- 前台 short run
- 后台 full run
- 日志流式查看
- 状态轮询
- artifact 回收

执行层统一抽象了：

- 本地执行
- SSH 执行

所以同一套实验计划可以在 loop 中决定落到本地还是远程 GPU 服务器。

## 命令

### 启动

```bash
/research start [flags] [topic]
```

### 恢复

```bash
/research resume [sessionId]
```

### 暂停

```bash
/research pause [sessionId]
```

### 查看状态

```bash
/research status [sessionId]
```

### 最终总结

```bash
/research summarize [sessionId] [summary|report|paper]
```

这一步才是明确进入总结/写作阶段的开关。

### 归档

```bash
/research archive [sessionId]
```

## 验证

如果你想先验证 ClawLab 这一层，而不是一次性跑完整个历史仓库的全量检查，可以直接用这两个定向脚本：

```bash
bun run lint:clawlab
bun run typecheck:clawlab
```

## Artifacts

每个 session 会把结构化输出写到：

```text
workspace/sessions/<sessionId>/
```

重点目录：

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

重点文件：

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

每轮只写 research round report，固定 11 段：

1. 本轮目标
2. 本轮调研发现
3. 本轮新增证据
4. 本轮代码改动
5. 本轮实验
6. 本轮关键结果
7. 本轮失败与修复
8. 当前 best-so-far
9. 当前不确定点
10. 下一轮计划
11. 本轮执行环境

第 11 段包含：

- local / remote
- remote host
- GPU allocation
- environment name
- working directory

## 示例文件

- 新课题示例：[examples/new-project.json](./examples/new-project.json)
- 现有项目改进示例：[examples/improve-existing-project.json](./examples/improve-existing-project.json)

## 关于参考项目

ClawLab 的设计重点吸收了现代 auto research 系统里比较有价值的模式：

- 显式阶段化 loop
- 持久化 artifacts
- 反思与重规划
- full run 之前的实验纪律
- 把远程执行当成常态路径
