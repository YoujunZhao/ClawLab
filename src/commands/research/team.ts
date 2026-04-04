import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalCommandResult } from '../../types/command.js'

type TeamRoleId =
	| 'conductor'
	| 'literature_scout'
	| 'experiment_driver'
	| 'paper_writer'
	| 'reviewer'

type ResearchStage = 'survey' | 'ideation' | 'experiment' | 'publication' | 'promotion'

type TemplateWriteResult = 'written' | 'skipped'

type TeamInitStats = {
	written: number
	skipped: number
}

type TeamRole = {
	id: TeamRoleId
	title: string
	responsibilities: string[]
	memoryFiles: string[]
	recommendedSkillIds: string[]
}

type TeamConfig = {
	version: number
	updatedAt: string
	pipeline: string[]
	roles: TeamRole[]
	memorySystem: {
		root: string
		sharedFiles: string[]
		roleIsolation: boolean
	}
}

type TeamState = {
	activeRole: TeamRoleId
	lastRoleSwitchAt: string
	notes: string
}

type BuiltInSkill = {
	id: string
	name: string
	category: string
	summary: string
	recommendedRoles: TeamRoleId[]
	recommendedStages: ResearchStage[]
	triggers: string[]
}

type SkillCatalog = {
	version: number
	updatedAt: string
	skills: BuiltInSkill[]
}

const TEAM_CONFIG_PATH = '.clawlab/team/team-config.json'
const TEAM_STATE_PATH = '.clawlab/team/team-state.json'
const SKILLS_CATALOG_PATH = '.clawlab/skills/catalog.json'
const TASKS_PATH = '.clawlab/tasks/tasks.json'

const stageValues: ResearchStage[] = [
	'survey',
	'ideation',
	'experiment',
	'publication',
	'promotion',
]

const teamRoles: TeamRole[] = [
	{
		id: 'conductor',
		title: 'Conductor',
		responsibilities: [
			'Own global planning and stage transitions.',
			'Dispatch tasks, review outputs, and maintain shared truth.',
			'Keep the loop moving with explicit next actions.',
		],
		memoryFiles: [
			'project_truth.md',
			'orchestrator_state.md',
			'decision_log.md',
			'agent_handoff.md',
		],
		recommendedSkillIds: [
			'research-pipeline-planner',
			'research-idea-convergence',
			'task-prioritization',
		],
	},
	{
		id: 'literature_scout',
		title: 'Literature Scout',
		responsibilities: [
			'Find papers, repos, and baselines efficiently.',
			'Build a clean evidence and citation trail.',
			'Highlight novelty gaps and known failure modes.',
		],
		memoryFiles: ['project_truth.md', 'literature_bank.md', 'execution_context.md'],
		recommendedSkillIds: ['paper-finder', 'citation-graph-builder', 'benchmark-discovery'],
	},
	{
		id: 'experiment_driver',
		title: 'Experiment Driver',
		responsibilities: [
			'Design validation-aware experiments and patch plans.',
			'Execute local or remote runs and track deltas.',
			'Classify failures and close the fix-verify loop.',
		],
		memoryFiles: [
			'project_truth.md',
			'execution_context.md',
			'experiment_ledger.md',
			'result_summary.md',
		],
		recommendedSkillIds: [
			'experiment-plan-author',
			'validation-pipeline-designer',
			'remote-experiment-operator',
		],
	},
	{
		id: 'paper_writer',
		title: 'Paper Writer',
		responsibilities: [
			'Turn validated outcomes into clear narrative.',
			'Draft sections, figures, and references.',
			'Keep claims aligned with evidence and metrics.',
		],
		memoryFiles: ['execution_context.md', 'result_summary.md', 'literature_bank.md'],
		recommendedSkillIds: ['paper-structure-planner', 'figure-storytelling', 'reference-auditor'],
	},
	{
		id: 'reviewer',
		title: 'Reviewer',
		responsibilities: [
			'Act as quality gate before release/publication.',
			'Challenge assumptions, stats validity, and reproducibility.',
			'Feed actionable review items back to the conductor.',
		],
		memoryFiles: ['project_truth.md', 'result_summary.md', 'review_log.md'],
		recommendedSkillIds: [
			'statistical-sanity-check',
			'reproducibility-audit',
			'claim-consistency-review',
		],
	},
]

const builtInSkills: BuiltInSkill[] = [
	{
		id: 'paper-finder',
		name: 'Paper Finder',
		category: 'literature',
		summary: 'Search papers by topic, novelty angle, and timeline.',
		recommendedRoles: ['literature_scout'],
		recommendedStages: ['survey'],
		triggers: ['paper', 'arxiv', 'survey'],
	},
	{
		id: 'paper-analyzer',
		name: 'Paper Analyzer',
		category: 'literature',
		summary: 'Extract method, dataset, metrics, and threat-to-validity notes.',
		recommendedRoles: ['literature_scout', 'reviewer'],
		recommendedStages: ['survey', 'publication'],
		triggers: ['analyze paper', 'method'],
	},
	{
		id: 'citation-graph-builder',
		name: 'Citation Graph Builder',
		category: 'literature',
		summary: 'Build forward/backward citation chains for lineage tracking.',
		recommendedRoles: ['literature_scout'],
		recommendedStages: ['survey'],
		triggers: ['citation', 'lineage'],
	},
	{
		id: 'dataset-discovery',
		name: 'Dataset Discovery',
		category: 'literature',
		summary: 'Map candidate datasets and license constraints quickly.',
		recommendedRoles: ['literature_scout', 'experiment_driver'],
		recommendedStages: ['survey', 'experiment'],
		triggers: ['dataset', 'benchmark'],
	},
	{
		id: 'benchmark-discovery',
		name: 'Benchmark Discovery',
		category: 'literature',
		summary: 'Identify accepted baselines and leaderboards for fair comparison.',
		recommendedRoles: ['literature_scout', 'reviewer'],
		recommendedStages: ['survey', 'publication'],
		triggers: ['leaderboard', 'baseline'],
	},
	{
		id: 'repo-scout',
		name: 'Repo Scout',
		category: 'literature',
		summary: 'Find implementation repos and audit reproducibility signals.',
		recommendedRoles: ['literature_scout', 'experiment_driver'],
		recommendedStages: ['survey', 'experiment'],
		triggers: ['github', 'implementation'],
	},
	{
		id: 'hypothesis-generator',
		name: 'Hypothesis Generator',
		category: 'ideation',
		summary: 'Generate testable hypotheses with measurable expected gains.',
		recommendedRoles: ['conductor', 'experiment_driver'],
		recommendedStages: ['ideation'],
		triggers: ['hypothesis', 'idea'],
	},
	{
		id: 'novelty-checker',
		name: 'Novelty Checker',
		category: 'ideation',
		summary: 'Check overlap against prior art and novelty risks.',
		recommendedRoles: ['conductor', 'literature_scout'],
		recommendedStages: ['ideation'],
		triggers: ['novelty', 'overlap'],
	},
	{
		id: 'feasibility-scorer',
		name: 'Feasibility Scorer',
		category: 'ideation',
		summary: 'Score ideas by complexity, cost, and expected evidence quality.',
		recommendedRoles: ['conductor'],
		recommendedStages: ['ideation'],
		triggers: ['feasibility', 'cost'],
	},
	{
		id: 'risk-mapper',
		name: 'Risk Mapper',
		category: 'ideation',
		summary: 'Map implementation and evaluation risks before coding.',
		recommendedRoles: ['conductor', 'reviewer'],
		recommendedStages: ['ideation', 'experiment'],
		triggers: ['risk', 'failure mode'],
	},
	{
		id: 'research-idea-convergence',
		name: 'Research Idea Convergence',
		category: 'ideation',
		summary: 'Converge candidate directions into ranked next actions.',
		recommendedRoles: ['conductor'],
		recommendedStages: ['ideation'],
		triggers: ['converge', 'prioritize'],
	},
	{
		id: 'ablation-planner',
		name: 'Ablation Planner',
		category: 'ideation',
		summary: 'Plan ablations that isolate contribution components.',
		recommendedRoles: ['experiment_driver', 'reviewer'],
		recommendedStages: ['ideation', 'experiment'],
		triggers: ['ablation', 'component'],
	},
	{
		id: 'experiment-plan-author',
		name: 'Experiment Plan Author',
		category: 'experiment',
		summary: 'Produce short-run/full-run plans with stopping rules.',
		recommendedRoles: ['experiment_driver'],
		recommendedStages: ['experiment'],
		triggers: ['experiment plan', 'run plan'],
	},
	{
		id: 'validation-pipeline-designer',
		name: 'Validation Pipeline Designer',
		category: 'experiment',
		summary: 'Design static-check, smoke-run, and regression guardrails.',
		recommendedRoles: ['experiment_driver'],
		recommendedStages: ['experiment'],
		triggers: ['smoke', 'validation'],
	},
	{
		id: 'eval-harness-builder',
		name: 'Eval Harness Builder',
		category: 'experiment',
		summary: 'Create reusable evaluation harness scripts and reports.',
		recommendedRoles: ['experiment_driver'],
		recommendedStages: ['experiment'],
		triggers: ['evaluation harness', 'metric report'],
	},
	{
		id: 'regression-debugger',
		name: 'Regression Debugger',
		category: 'experiment',
		summary: 'Classify regression causes and propose minimal fixes.',
		recommendedRoles: ['experiment_driver', 'reviewer'],
		recommendedStages: ['experiment'],
		triggers: ['regression', 'debug'],
	},
	{
		id: 'remote-experiment-operator',
		name: 'Remote Experiment Operator',
		category: 'experiment',
		summary: 'Operate SSH/GPU runs with resilient log and artifact capture.',
		recommendedRoles: ['experiment_driver'],
		recommendedStages: ['experiment'],
		triggers: ['ssh', 'gpu'],
	},
	{
		id: 'gpu-budget-planner',
		name: 'GPU Budget Planner',
		category: 'experiment',
		summary: 'Allocate GPU time and run order under budget constraints.',
		recommendedRoles: ['conductor', 'experiment_driver'],
		recommendedStages: ['experiment'],
		triggers: ['budget', 'gpu scheduling'],
	},
	{
		id: 'data-quality-auditor',
		name: 'Data Quality Auditor',
		category: 'experiment',
		summary: 'Detect leakage, label drift, and split hygiene issues.',
		recommendedRoles: ['experiment_driver', 'reviewer'],
		recommendedStages: ['experiment'],
		triggers: ['data leakage', 'label quality'],
	},
	{
		id: 'profiling-analysis',
		name: 'Profiling Analysis',
		category: 'engineering',
		summary: 'Analyze bottlenecks with profiler evidence and tuning actions.',
		recommendedRoles: ['experiment_driver'],
		recommendedStages: ['experiment', 'promotion'],
		triggers: ['profile', 'latency'],
	},
	{
		id: 'memory-optimization',
		name: 'Memory Optimization',
		category: 'engineering',
		summary: 'Reduce memory pressure and stabilize long runs.',
		recommendedRoles: ['experiment_driver'],
		recommendedStages: ['experiment'],
		triggers: ['oom', 'memory'],
	},
	{
		id: 'patch-safety-review',
		name: 'Patch Safety Review',
		category: 'engineering',
		summary: 'Review patches for side effects and rollback safety.',
		recommendedRoles: ['reviewer', 'experiment_driver'],
		recommendedStages: ['experiment', 'publication'],
		triggers: ['patch', 'safety'],
	},
	{
		id: 'test-hardening',
		name: 'Test Hardening',
		category: 'engineering',
		summary: 'Strengthen flaky tests and add deterministic checks.',
		recommendedRoles: ['experiment_driver', 'reviewer'],
		recommendedStages: ['experiment'],
		triggers: ['flaky test', 'stability'],
	},
	{
		id: 'paper-structure-planner',
		name: 'Paper Structure Planner',
		category: 'writing',
		summary: 'Map evidence to section skeleton and argument flow.',
		recommendedRoles: ['paper_writer'],
		recommendedStages: ['publication'],
		triggers: ['paper outline', 'section plan'],
	},
	{
		id: 'scientific-writing',
		name: 'Scientific Writing',
		category: 'writing',
		summary: 'Draft concise claims with explicit evidence boundaries.',
		recommendedRoles: ['paper_writer'],
		recommendedStages: ['publication'],
		triggers: ['writing', 'draft'],
	},
	{
		id: 'figure-storytelling',
		name: 'Figure Storytelling',
		category: 'writing',
		summary: 'Design figures and captions that match core claims.',
		recommendedRoles: ['paper_writer'],
		recommendedStages: ['publication', 'promotion'],
		triggers: ['figure', 'caption'],
	},
	{
		id: 'reference-auditor',
		name: 'Reference Auditor',
		category: 'writing',
		summary: 'Audit citations for support quality and formatting consistency.',
		recommendedRoles: ['paper_writer', 'reviewer'],
		recommendedStages: ['publication'],
		triggers: ['reference', 'citation'],
	},
	{
		id: 'result-summarizer',
		name: 'Result Summarizer',
		category: 'writing',
		summary: 'Summarize validated results into reusable report blocks.',
		recommendedRoles: ['paper_writer', 'conductor'],
		recommendedStages: ['publication', 'promotion'],
		triggers: ['summary', 'report'],
	},
	{
		id: 'rebuttal-drafter',
		name: 'Rebuttal Drafter',
		category: 'writing',
		summary: 'Prepare rebuttal responses with evidence-linked checkpoints.',
		recommendedRoles: ['paper_writer', 'reviewer'],
		recommendedStages: ['publication', 'promotion'],
		triggers: ['rebuttal', 'response'],
	},
	{
		id: 'statistical-sanity-check',
		name: 'Statistical Sanity Check',
		category: 'review',
		summary: 'Check significance claims and variance interpretation.',
		recommendedRoles: ['reviewer'],
		recommendedStages: ['experiment', 'publication'],
		triggers: ['p-value', 'confidence interval'],
	},
	{
		id: 'reproducibility-audit',
		name: 'Reproducibility Audit',
		category: 'review',
		summary: 'Audit seeds, configs, versions, and run traces for reproducibility.',
		recommendedRoles: ['reviewer'],
		recommendedStages: ['experiment', 'publication'],
		triggers: ['reproduce', 'determinism'],
	},
	{
		id: 'methodology-critic',
		name: 'Methodology Critic',
		category: 'review',
		summary: 'Red-team experimental design and baseline fairness.',
		recommendedRoles: ['reviewer'],
		recommendedStages: ['ideation', 'publication'],
		triggers: ['methodology', 'baseline fairness'],
	},
	{
		id: 'claim-consistency-review',
		name: 'Claim Consistency Review',
		category: 'review',
		summary: 'Ensure claims align with measured evidence across sections.',
		recommendedRoles: ['reviewer', 'paper_writer'],
		recommendedStages: ['publication'],
		triggers: ['claim', 'consistency'],
	},
	{
		id: 'artifact-packager',
		name: 'Artifact Packager',
		category: 'ops',
		summary: 'Package checkpoints, configs, and run logs for release.',
		recommendedRoles: ['conductor', 'experiment_driver'],
		recommendedStages: ['promotion'],
		triggers: ['package artifact', 'release asset'],
	},
	{
		id: 'release-note-generator',
		name: 'Release Note Generator',
		category: 'ops',
		summary: 'Generate concise release notes from round reports.',
		recommendedRoles: ['conductor', 'paper_writer'],
		recommendedStages: ['promotion'],
		triggers: ['release notes', 'changelog'],
	},
	{
		id: 'demo-script-writer',
		name: 'Demo Script Writer',
		category: 'ops',
		summary: 'Create reproducible demo scripts with fallback paths.',
		recommendedRoles: ['conductor', 'paper_writer'],
		recommendedStages: ['promotion'],
		triggers: ['demo', 'walkthrough'],
	},
	{
		id: 'presentation-outline',
		name: 'Presentation Outline',
		category: 'ops',
		summary: 'Build a concise talk outline from evidence and key deltas.',
		recommendedRoles: ['paper_writer'],
		recommendedStages: ['promotion'],
		triggers: ['slides', 'talk'],
	},
	{
		id: 'research-pipeline-planner',
		name: 'Research Pipeline Planner',
		category: 'planning',
		summary: 'Plan stage transitions with clear entry and exit checks.',
		recommendedRoles: ['conductor'],
		recommendedStages: ['survey', 'ideation', 'experiment', 'publication', 'promotion'],
		triggers: ['pipeline', 'stage'],
	},
	{
		id: 'task-prioritization',
		name: 'Task Prioritization',
		category: 'planning',
		summary: 'Rank tasks by expected impact, risk, and unblock power.',
		recommendedRoles: ['conductor'],
		recommendedStages: ['survey', 'ideation', 'experiment'],
		triggers: ['priority', 'backlog'],
	},
	{
		id: 'decision-log-maintainer',
		name: 'Decision Log Maintainer',
		category: 'planning',
		summary: 'Track accepted and rejected directions with rationale.',
		recommendedRoles: ['conductor', 'reviewer'],
		recommendedStages: ['ideation', 'experiment', 'publication'],
		triggers: ['decision', 'rationale'],
	},
]

const memoryTemplateFiles = [
	{
		relativePath: '.clawlab/memory/orchestrator_state.md',
		content: [
			'# Orchestrator State',
			'',
			'- Active stage: survey',
			'- Active role: conductor',
			'',
		].join('\n'),
	},
	{
		relativePath: '.clawlab/memory/execution_context.md',
		content: ['# Execution Context', '', '- Current task scope and constraints.', ''].join('\n'),
	},
	{
		relativePath: '.clawlab/memory/review_log.md',
		content: ['# Review Log', '', '- Reviewer findings and action items.', ''].join('\n'),
	},
]

type SkillQuery = {
	role?: TeamRoleId
	stage?: ResearchStage
	category?: string
}

function formatJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`
}

function isErrorWithCode(error: unknown, code: string): boolean {
	if (!error || typeof error !== 'object') {
		return false
	}
	const maybeError = error as { code?: string }
	return maybeError.code === code
}

function isRoleId(value: string): value is TeamRoleId {
	return teamRoles.some((role) => role.id === value)
}

function isStage(value: string): value is ResearchStage {
	return stageValues.includes(value as ResearchStage)
}

function buildTeamConfig(): TeamConfig {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		pipeline: ['team-plan', 'team-prd', 'team-exec', 'team-verify', 'team-fix'],
		roles: teamRoles,
		memorySystem: {
			root: '.clawlab/memory',
			sharedFiles: [
				'project_truth.md',
				'literature_bank.md',
				'experiment_ledger.md',
				'result_summary.md',
				'agent_handoff.md',
				'decision_log.md',
			],
			roleIsolation: true,
		},
	}
}

function buildTeamState(): TeamState {
	return {
		activeRole: 'conductor',
		lastRoleSwitchAt: new Date().toISOString(),
		notes: 'Use /research team switch <role> to change focus role.',
	}
}

function buildSkillCatalog(): SkillCatalog {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		skills: builtInSkills,
	}
}

async function writeTemplate(
	cwd: string,
	relativePath: string,
	content: string,
	force: boolean,
): Promise<TemplateWriteResult> {
	const filePath = join(cwd, relativePath)
	if (force) {
		await writeFile(filePath, content, 'utf8')
		return 'written'
	}
	try {
		await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
		return 'written'
	} catch (error) {
		if (isErrorWithCode(error, 'EEXIST')) {
			return 'skipped'
		}
		throw error
	}
}

async function readJsonFile<T>(cwd: string, relativePath: string): Promise<T | undefined> {
	try {
		const raw = await readFile(join(cwd, relativePath), 'utf8')
		return JSON.parse(raw) as T
	} catch (error) {
		if (isErrorWithCode(error, 'ENOENT')) {
			return undefined
		}
		throw error
	}
}

function parseForceFlag(tokens: string[]): { force: boolean } {
	let force = false
	for (const token of tokens) {
		if (token === '--force') {
			force = true
			continue
		}
		throw new Error(
			`research team init received unknown option: ${token}. Supported option: --force`,
		)
	}
	return { force }
}

function parseSkillQuery(tokens: string[]): SkillQuery {
	const query: SkillQuery = {}
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		if (token === '--stage') {
			const stage = tokens[index + 1]
			if (!stage || !isStage(stage)) {
				throw new Error(
					'--stage requires one of: survey, ideation, experiment, publication, promotion',
				)
			}
			query.stage = stage
			index += 1
			continue
		}
		if (token === '--category') {
			const category = tokens[index + 1]
			if (!category) {
				throw new Error('--category requires a value')
			}
			query.category = category
			index += 1
			continue
		}
		if (!query.role && isRoleId(token)) {
			query.role = token
			continue
		}
		throw new Error(
			`research team skills received unknown token: ${token}. Use [role] [--stage <stage>] [--category <name>]`,
		)
	}
	return query
}

function formatRoleSummary(role: TeamRole): string {
	return `${role.id} (${role.title})`
}

function filterSkills(skills: BuiltInSkill[], query: SkillQuery): BuiltInSkill[] {
	let filtered = skills
	if (query.role) {
		filtered = filtered.filter((skill) => skill.recommendedRoles.includes(query.role as TeamRoleId))
	}
	if (query.stage) {
		filtered = filtered.filter((skill) =>
			skill.recommendedStages.includes(query.stage as ResearchStage),
		)
	}
	if (query.category) {
		const normalized = query.category.toLowerCase()
		filtered = filtered.filter((skill) => skill.category.toLowerCase() === normalized)
	}
	return filtered
}

function formatSkillLine(skill: BuiltInSkill): string {
	return `- ${skill.id} [${skill.category}] ${skill.name}: ${skill.summary}`
}

async function readActiveStage(cwd: string): Promise<string | undefined> {
	const tasks = await readJsonFile<{ activeStage?: string }>(cwd, TASKS_PATH)
	return tasks?.activeStage
}

async function loadTeamConfigAndState(
	cwd: string,
): Promise<{ config: TeamConfig; state: TeamState } | undefined> {
	const config = await readJsonFile<TeamConfig>(cwd, TEAM_CONFIG_PATH)
	const state = await readJsonFile<TeamState>(cwd, TEAM_STATE_PATH)
	if (!config || !state) {
		return undefined
	}
	return { config, state }
}

export async function initializeTeamArtifacts(cwd: string, force: boolean): Promise<TeamInitStats> {
	await mkdir(join(cwd, '.clawlab/team'), { recursive: true })
	await mkdir(join(cwd, '.clawlab/skills'), { recursive: true })
	await mkdir(join(cwd, '.clawlab/memory'), { recursive: true })

	const templates = [
		{ relativePath: TEAM_CONFIG_PATH, content: formatJson(buildTeamConfig()) },
		{ relativePath: TEAM_STATE_PATH, content: formatJson(buildTeamState()) },
		{ relativePath: SKILLS_CATALOG_PATH, content: formatJson(buildSkillCatalog()) },
		...memoryTemplateFiles,
	]

	let written = 0
	let skipped = 0
	for (const template of templates) {
		const result = await writeTemplate(cwd, template.relativePath, template.content, force)
		if (result === 'written') {
			written += 1
		} else {
			skipped += 1
		}
	}
	return { written, skipped }
}

async function runTeamInit(cwd: string, tokens: string[]): Promise<LocalCommandResult> {
	const { force } = parseForceFlag(tokens)
	const stats = await initializeTeamArtifacts(cwd, force)
	const lines = [
		`Initialized research team artifacts at ${cwd}.`,
		'',
		`Team files written: ${stats.written}`,
		`Team files skipped: ${stats.skipped}`,
		'Roles available: conductor, literature_scout, experiment_driver, paper_writer, reviewer',
	]
	if (force) {
		lines.push('Overwrite mode: enabled (--force)')
	}
	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

async function runTeamStatus(cwd: string): Promise<LocalCommandResult> {
	const loaded = await loadTeamConfigAndState(cwd)
	if (!loaded) {
		return {
			type: 'text',
			value: 'Team artifacts not initialized. Run /research team init first (or /research setup).',
		}
	}
	const activeRole = loaded.config.roles.find((role) => role.id === loaded.state.activeRole)
	const activeStage = await readActiveStage(cwd)
	const lines = [
		`Team pipeline: ${loaded.config.pipeline.join(' -> ')}`,
		`Active stage: ${activeStage ?? 'unknown'}`,
		`Active role: ${activeRole ? formatRoleSummary(activeRole) : loaded.state.activeRole}`,
		`Last role switch: ${loaded.state.lastRoleSwitchAt}`,
		'',
		'Next commands:',
		'- /research team roles',
		'- /research team switch reviewer',
		'- /research team skills --stage experiment',
	]
	if (activeRole) {
		lines.push('', 'Current role responsibilities:')
		for (const item of activeRole.responsibilities) {
			lines.push(`- ${item}`)
		}
	}
	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

function runTeamRoles(): LocalCommandResult {
	const lines = ['Agent Team Roles:']
	for (const role of teamRoles) {
		lines.push('', `- ${formatRoleSummary(role)}`)
		lines.push(`  memory: ${role.memoryFiles.join(', ')}`)
		lines.push(`  responsibilities: ${role.responsibilities.join(' | ')}`)
	}
	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

async function runTeamSkills(cwd: string, tokens: string[]): Promise<LocalCommandResult> {
	const query = parseSkillQuery(tokens)
	const activeStage = await readActiveStage(cwd)
	const filtered = filterSkills(builtInSkills, query)
	if (filtered.length === 0) {
		return {
			type: 'text',
			value: 'No built-in skills matched the filter. Try /research team skills with fewer filters.',
		}
	}
	const categoryCounts = new Map<string, number>()
	for (const skill of filtered) {
		categoryCounts.set(skill.category, (categoryCounts.get(skill.category) ?? 0) + 1)
	}
	const categorySummary = Array.from(categoryCounts.entries())
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([category, count]) => `${category}:${count}`)
		.join(', ')

	const lines = [
		`Built-in skills: ${filtered.length}/${builtInSkills.length}`,
		`Current stage from tasks: ${activeStage ?? 'unknown'}`,
		`Filters: role=${query.role ?? 'any'}, stage=${query.stage ?? 'any'}, category=${query.category ?? 'any'}`,
		`Category split: ${categorySummary}`,
		'',
	]
	for (const skill of filtered) {
		lines.push(formatSkillLine(skill))
	}
	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

async function runTeamSwitch(cwd: string, tokens: string[]): Promise<LocalCommandResult> {
	const roleToken = tokens[0]
	if (!roleToken || !isRoleId(roleToken)) {
		throw new Error(
			'research team switch requires a role: conductor|literature_scout|experiment_driver|paper_writer|reviewer',
		)
	}
	if (tokens.length > 1) {
		throw new Error('research team switch accepts exactly one role argument')
	}
	const loaded = await loadTeamConfigAndState(cwd)
	if (!loaded) {
		return {
			type: 'text',
			value: 'Team artifacts not initialized. Run /research team init first (or /research setup).',
		}
	}
	const nextState: TeamState = {
		...loaded.state,
		activeRole: roleToken,
		lastRoleSwitchAt: new Date().toISOString(),
	}
	await writeFile(join(cwd, TEAM_STATE_PATH), formatJson(nextState), 'utf8')
	const role = teamRoles.find((item) => item.id === roleToken)
	const lines = [
		`Switched active team role to ${role ? formatRoleSummary(role) : roleToken}.`,
		'',
		'Recommended memory files:',
		...(role?.memoryFiles.map((file) => `- .clawlab/memory/${file}`) ?? []),
	]
	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

function runTeamHelp(): LocalCommandResult {
	return {
		type: 'text',
		value: [
			'Research team commands:',
			'- /research team init [--force]',
			'- /research team status',
			'- /research team roles',
			'- /research team skills [role] [--stage <stage>] [--category <name>]',
			'- /research team switch <role>',
		].join('\n'),
	}
}

export async function runTeamCommand(cwd: string, tail: string[]): Promise<LocalCommandResult> {
	const subcommand = tail[0] ?? 'status'
	const tokens = tail.slice(1)
	if (subcommand === 'init') {
		return runTeamInit(cwd, tokens)
	}
	if (subcommand === 'status') {
		return runTeamStatus(cwd)
	}
	if (subcommand === 'roles') {
		return runTeamRoles()
	}
	if (subcommand === 'skills') {
		return runTeamSkills(cwd, tokens)
	}
	if (subcommand === 'switch') {
		return runTeamSwitch(cwd, tokens)
	}
	if (subcommand === 'help') {
		return runTeamHelp()
	}
	throw new Error(
		`research team subcommand not recognized: ${subcommand}. Run /research team help.`,
	)
}
