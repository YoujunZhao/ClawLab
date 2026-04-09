# ClawLab 使用指南

## 这份文档讲什么

这份文档只讲当前仓库里已经真实落地、能跑、能验证的能力：

- 自动科研主循环怎么用
- Codex / Claude Code / OpenClaw 原生接入怎么检查和初始化
- rebuttal 模式怎么跑
- 本地可执行 skill 怎么用
- 现在应该用什么命令做验证

## 当前稳定命令面

### 自动科研

```bash
/research setup
/research start --mode new "topic"
/research start --mode improve --repo /path --problem "..."
/research status
/research pause
/research resume
/research summarize report
```

### 原生接入

```bash
/research integration status
/research integration doctor
/research integration doctor codex
/research integration init codex
/research integration init claude-code
/research integration init openclaw
```

### Rebuttal 流程

```bash
/research rebuttal init
/research rebuttal plan --paper paper.pdf --review review1.pdf --review review2.txt --repo /path/to/repo --venue neurips
/research rebuttal draft --run-dir /path/to/run
/research rebuttal validate --draft /path/to/rebuttal_draft.md --venue neurips
```

### 本地可执行 Skill

```bash
/research skills list
/research skills show integration-doctor
/research skills run integration-doctor
/research skills run review-concern-extract --review review.pdf
```

## 逐步使用

### 1. 安装并启动

```bash
bun install
bun src/entrypoints/cli.tsx
```

如果你想复用 Anthropic OAuth：

```bash
/login
```

### 2. 初始化本地工作区

```bash
/research setup
```

这一步会创建 `.clawlab/` 目录，用来放：

- task 追踪
- integration 模板
- rebuttal 运行产物
- skill 运行产物
- memory 文件

### 3. 选择主路径

#### 路径 A：从 topic 开始科研

```bash
/research start --mode new "robust planning for browser agents"
```

#### 路径 B：改进现有项目

```bash
/research start \
  --mode improve \
  --repo /workspace/ranker \
  --problem "NDCG@10 plateaued at 0.488" \
  --target-metric ndcg_at_10 \
  --current-metric ndcg_at_10=0.488 \
  --goal "reach 0.51+ without major latency regression"
```

#### 路径 C：做 rebuttal

当你已经有论文/草稿和 reviewer comments 时，用这条路径：

```bash
/research rebuttal plan \
  --paper /workspace/paper.pdf \
  --review /workspace/review1.pdf \
  --review /workspace/review2.txt \
  --repo /workspace/project \
  --venue cvpr
```

然后继续：

```bash
/research rebuttal draft --run-dir /workspace/.clawlab/rebuttal/runs/run_...
/research rebuttal validate --draft /workspace/.clawlab/rebuttal/runs/run_.../rebuttal_draft.md --venue cvpr
```

## 原生接入说明

ClawLab 现在把 Codex、Claude Code、OpenClaw 当成真实的 native integration target，而不是只写在 README 里的名字。

### Codex

当前能做的事：

- 检测 `codex` 是否在 `PATH`
- 检测 `~/.codex/config.toml`
- 检测 `~/.codex/auth.json` 或 `OPENAI_API_KEY`
- 生成 `.codex/AGENTS.md`
- 生成 `.codex/config.toml`

### Claude Code

当前能做的事：

- 检测 `claude` 是否在 `PATH`
- 检测 `~/.claude/settings.json` 或 `~/.claude/settings.local.json`
- 生成 `.claude/agents/clawlab-research.md`
- 生成 `.claude/settings.local.json`

当前限制：

- ClawLab 不会仅凭静态文件就声称 “Claude 交互式登录一定有效”。

### OpenClaw

当前能做的事：

- 检测 `openclaw` 是否在 `PATH`
- 检测 `~/.openclaw/openclaw.json`
- 检查配置里是否存在 auth/profile 线索
- 生成 `.openclaw/clawlab.project.json5`
- 生成 `.openclaw/README.md`

## Rebuttal 细节

### 输入

- 论文 PDF 或文本
- 一个或多个 review PDF / 文本
- 可选 repo 路径
- venue 预设

### 输出

每次 rebuttal run 会写出：

- 提取后的 paper 文本
- 提取后的 review 文本
- concern map
- venue policy 快照
- repo evidence map
- rebuttal plan
- rebuttal draft
- validation report

### 内置 venue 预设

- `cvpr`
- `neurips`
- `iclr`
- `acl_arr`
- `generic`

当前已经覆盖：

- 字数限制
- 字符数限制
- 近似页数限制
- 是否允许外链
- 是否需要匿名
- venue 备注

### Draft 生成逻辑

ClawLab 会先尝试走当前 auto model router 的模型起草。

如果当前机器上没有可用模型认证，就退回到 deterministic template draft。

也就是说：整个 rebuttal pipeline 本身是可跑的，但 draft 质量取决于你机器上到底有没有可用模型连接。

## 本地可执行 Skill

当前内置且本地可执行的 skill：

- `integration-doctor`
- `review-concern-extract`
- `venue-policy-check`
- `repo-evidence-scan`
- `rebuttal-plan`

这些是本地真的能 `run` 的。

另外还有一些外部参考生态，比如：

- Paper2Rebuttal
- ClawHub Research Library
- ClawHub OpenReview Review Analyzer
- ClawHub Code Auditor

这些会作为 external references 展示，不会冒充成本地内置 skill。

## Team 说明

当前 `/research team ...` 的定位是：

- role scaffolding
- role memory template
- role switch
- role-oriented playbook suggestion

它目前 **不是** 内嵌 OMX `$team` durable runtime。

## 验证

请使用：

```bash
bun run lint:clawlab
bun run test:clawlab
bun run check:clawlab
```

当前这次实现里，我能真实确认的是：

- focused ClawLab tests 通过
- focused ClawLab lint 通过，只有复杂度 warning

由于这个仓库本身带有很多与 ClawLab 无关的上游 TypeScript 问题，所以现在应该把 focused tests + focused lint 当成这次工作的诚实验收线。
