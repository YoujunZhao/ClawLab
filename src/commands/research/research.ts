import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolUseContext } from '../../Tool.js'
import { AutoResearchService, type ResearchMissionInput } from '../../research/index.js'
import type { LocalCommandResult } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { initializeTeamArtifacts, runTeamCommand } from './team.js'

function tokenize(args: string): string[] {
	return Array.from(args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)).map(
		(match) => match[1] ?? match[2] ?? match[3],
	)
}

function parseMetricAssignment(value: string): [string, number] {
	const [name, raw] = value.split('=')
	if (!name || raw === undefined) {
		throw new Error('--current-metric requires the form name=value')
	}
	const parsed = Number(raw)
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid metric value for ${name}: ${raw}`)
	}
	return [name, parsed]
}

function parseTaskModelAssignment(
	value: string,
): ['research' | 'code' | 'report' | 'summary', string] {
	const [task, model] = value.split('=')
	if (!task || !model) {
		throw new Error('--task-model requires the form task=model')
	}
	if (!['research', 'code', 'report', 'summary'].includes(task)) {
		throw new Error(
			`Invalid task for --task-model: ${task}. Expected research, code, report, or summary.`,
		)
	}
	return [task as 'research' | 'code' | 'report' | 'summary', model]
}

function requireOptionValue(tokens: string[], index: number, message: string): string {
	const value = tokens[index + 1]
	if (!value) {
		throw new Error(message)
	}
	return value
}

function ensureModelConnection(
	input: ResearchMissionInput,
): NonNullable<ResearchMissionInput['modelConnection']> {
	if (!input.modelConnection) {
		input.modelConnection = {
			provider: 'auto',
			taskModels: {},
		}
		return input.modelConnection
	}
	input.modelConnection = {
		...input.modelConnection,
		taskModels: {
			...(input.modelConnection.taskModels ?? {}),
		},
	}
	return input.modelConnection
}

function normalizeModelProvider(
	value: string,
): NonNullable<ResearchMissionInput['modelConnection']>['provider'] {
	if (value === 'anthropic-oauth') {
		return 'anthropic_oauth'
	}
	if (value === 'anthropic-api-key') {
		return 'anthropic_api_key'
	}
	if (value === 'openai-compatible') {
		return 'openai_compatible'
	}
	if (value === 'stub') {
		return 'stub'
	}
	return 'auto'
}

type MissionOptionHandler = (
	tokens: string[],
	index: number,
	input: ResearchMissionInput,
) => number | Promise<number>

type SetupWriteResult = 'written' | 'skipped'

const setupDirectories = [
	'paper',
	'paper/sections',
	'paper/refs',
	'experiment',
	'survey',
	'ideation',
	'promotion',
	'skills',
	'.clawlab/tasks',
	'.clawlab/docs',
	'.clawlab/memory',
	'.clawlab/team',
	'.clawlab/skills',
]

const missionOptionHandlers: Record<string, MissionOptionHandler> = {
	'--config': async (tokens, index, input) => {
		const configPath = requireOptionValue(tokens, index, '--config requires a file path')
		const loaded = JSON.parse(await readFile(configPath, 'utf8')) as ResearchMissionInput
		Object.assign(input, loaded)
		return index + 1
	},
	'--rounds': (tokens, index, input) => {
		const roundsToken = requireOptionValue(tokens, index, '--rounds requires a number')
		const rounds = Number(roundsToken)
		if (!Number.isFinite(rounds)) {
			throw new Error(`Invalid value for --rounds: ${roundsToken}`)
		}
		input.budget = {
			...input.budget,
			maxRounds: rounds,
		}
		return index + 1
	},
	'--mode': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--mode requires new or improve')
		input.missionType =
			value === 'improve' || value === 'existing_project_improvement'
				? 'existing_project_improvement'
				: 'new_project'
		return index + 1
	},
	'--repo': (tokens, index, input) => {
		input.repoPath = requireOptionValue(tokens, index, '--repo requires a path')
		return index + 1
	},
	'--problem': (tokens, index, input) => {
		input.problemStatement = requireOptionValue(tokens, index, '--problem requires text')
		return index + 1
	},
	'--goal': (tokens, index, input) => {
		input.improvementGoal = requireOptionValue(tokens, index, '--goal requires text')
		return index + 1
	},
	'--baseline': (tokens, index, input) => {
		input.baselineSummary = requireOptionValue(tokens, index, '--baseline requires text')
		return index + 1
	},
	'--target-metric': (tokens, index, input) => {
		input.targetMetric = requireOptionValue(tokens, index, '--target-metric requires a metric name')
		return index + 1
	},
	'--current-metric': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--current-metric requires name=value')
		const [name, parsed] = parseMetricAssignment(value)
		input.currentMetricsSnapshot = {
			...input.currentMetricsSnapshot,
			[name]: parsed,
		}
		return index + 1
	},
	'--focus-file': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--focus-file requires a path')
		input.preferredFocusFiles = [...(input.preferredFocusFiles ?? []), value]
		return index + 1
	},
	'--keyword': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--keyword requires text')
		input.keywords = [...(input.keywords ?? []), value]
		return index + 1
	},
	'--question': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--question requires text')
		input.targetQuestions = [...(input.targetQuestions ?? []), value]
		return index + 1
	},
	'--model-provider': (tokens, index, input) => {
		const value = requireOptionValue(
			tokens,
			index,
			'--model-provider requires auto, stub, anthropic-oauth, anthropic-api-key, or openai-compatible',
		)
		const modelConnection = ensureModelConnection(input)
		modelConnection.provider = normalizeModelProvider(value)
		return index + 1
	},
	'--model': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--model requires a model name')
		const modelConnection = ensureModelConnection(input)
		modelConnection.model = value
		return index + 1
	},
	'--task-model': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--task-model requires task=model')
		const [task, model] = parseTaskModelAssignment(value)
		const modelConnection = ensureModelConnection(input)
		modelConnection.taskModels = {
			...(modelConnection.taskModels ?? {}),
			[task]: model,
		}
		return index + 1
	},
	'--model-base-url': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--model-base-url requires a URL')
		const modelConnection = ensureModelConnection(input)
		modelConnection.baseUrl = value
		return index + 1
	},
	'--model-api-key-env': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--model-api-key-env requires an env var name')
		const modelConnection = ensureModelConnection(input)
		modelConnection.apiKeyEnvVar = value
		return index + 1
	},
	'--model-display-name': (tokens, index, input) => {
		const value = requireOptionValue(tokens, index, '--model-display-name requires text')
		const modelConnection = ensureModelConnection(input)
		modelConnection.displayName = value
		return index + 1
	},
}

function buildTasksTemplate(): string {
	return `${JSON.stringify(
		{
			version: 1,
			updatedAt: new Date().toISOString(),
			activeStage: 'survey',
			stages: [
				{
					id: 'survey',
					title: 'Survey',
					status: 'todo',
					description: 'Collect literature, repos, baselines, and failure modes.',
				},
				{
					id: 'ideation',
					title: 'Ideation',
					status: 'todo',
					description: 'Generate, score, and prioritize hypotheses.',
				},
				{
					id: 'experiment',
					title: 'Experiment',
					status: 'todo',
					description: 'Patch code, validate, run experiments, and analyze results.',
				},
				{
					id: 'publication',
					title: 'Publication',
					status: 'todo',
					description: 'Draft summary/report/paper artifacts.',
				},
				{
					id: 'promotion',
					title: 'Promotion',
					status: 'todo',
					description: 'Package outputs for sharing, demo, or release.',
				},
			],
		},
		null,
		2,
	)}\n`
}

function buildResearchBriefTemplate(): string {
	return `${JSON.stringify(
		{
			topic: '',
			problemStatement: '',
			targetMetric: '',
			currentMetricsSnapshot: {},
			improvementGoal: '',
			constraints: [],
			notes: 'Fill this brief before starting /research start for better planning quality.',
		},
		null,
		2,
	)}\n`
}

function getSetupFiles(): Array<{ relativePath: string; content: string }> {
	return [
		{
			relativePath: 'paper/main.tex',
			content: [
				'\\documentclass{article}',
				'\\usepackage[utf8]{inputenc}',
				'\\title{Research Draft}',
				'\\author{ClawLab}',
				'\\date{\\today}',
				'',
				'\\begin{document}',
				'\\maketitle',
				'',
				'\\input{sections/01-introduction.tex}',
				'',
				'\\bibliographystyle{plain}',
				'\\bibliography{refs/references}',
				'\\end{document}',
				'',
			].join('\n'),
		},
		{
			relativePath: 'paper/sections/01-introduction.tex',
			content: ['\\section{Introduction}', '', 'Draft your introduction here.', ''].join('\n'),
		},
		{
			relativePath: 'paper/refs/references.bib',
			content: ['% Add BibTeX entries here.', ''].join('\n'),
		},
		{
			relativePath: '.clawlab/tasks/tasks.json',
			content: buildTasksTemplate(),
		},
		{
			relativePath: '.clawlab/docs/research_brief.json',
			content: buildResearchBriefTemplate(),
		},
		{
			relativePath: '.clawlab/memory/project_truth.md',
			content: [
				'# Project Truth',
				'',
				'- Mission status: not started',
				'- Last update: not set',
				'',
			].join('\n'),
		},
		{
			relativePath: '.clawlab/memory/literature_bank.md',
			content: ['# Literature Bank', '', '- Add key papers, links, and takeaways here.', ''].join(
				'\n',
			),
		},
		{
			relativePath: '.clawlab/memory/experiment_ledger.md',
			content: [
				'# Experiment Ledger',
				'',
				'- Track command, config, metric deltas, and verdict per run.',
				'',
			].join('\n'),
		},
		{
			relativePath: '.clawlab/memory/result_summary.md',
			content: [
				'# Result Summary',
				'',
				'- Keep latest validated best-so-far summary here.',
				'',
			].join('\n'),
		},
		{
			relativePath: '.clawlab/memory/agent_handoff.md',
			content: ['# Agent Handoff', '', '- Cross-role handoff notes and pending actions.', ''].join(
				'\n',
			),
		},
		{
			relativePath: '.clawlab/memory/decision_log.md',
			content: [
				'# Decision Log',
				'',
				'- Record rejected paths and reasoning to avoid repeats.',
				'',
			].join('\n'),
		},
	]
}

function isFileAlreadyExistsError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false
	}
	const maybeError = error as { code?: string }
	return maybeError.code === 'EEXIST'
}

async function writeSetupFile(
	cwd: string,
	relativePath: string,
	content: string,
	force: boolean,
): Promise<SetupWriteResult> {
	const filePath = join(cwd, relativePath)
	if (force) {
		await writeFile(filePath, content, 'utf8')
		return 'written'
	}
	try {
		await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
		return 'written'
	} catch (error) {
		if (isFileAlreadyExistsError(error)) {
			return 'skipped'
		}
		throw error
	}
}

function parseSetupOptions(tail: string[]): { force: boolean } {
	let force = false
	for (const token of tail) {
		if (token === '--force') {
			force = true
			continue
		}
		throw new Error(`research setup received unknown option: ${token}. Supported option: --force`)
	}
	return { force }
}

async function runSetup(cwd: string, tail: string[]): Promise<LocalCommandResult> {
	const { force } = parseSetupOptions(tail)
	for (const dir of setupDirectories) {
		await mkdir(join(cwd, dir), { recursive: true })
	}
	let filesWritten = 0
	let filesSkipped = 0
	for (const file of getSetupFiles()) {
		const result = await writeSetupFile(cwd, file.relativePath, file.content, force)
		if (result === 'written') {
			filesWritten += 1
		} else {
			filesSkipped += 1
		}
	}
	const teamStats = await initializeTeamArtifacts(cwd, force)

	const lines = [
		`Initialized ClawLab scaffold at ${cwd}.`,
		'',
		`Directories ensured: ${setupDirectories.length}`,
		`Files written: ${filesWritten}`,
		`Files skipped: ${filesSkipped}`,
		`Team files written: ${teamStats.written}`,
		`Team files skipped: ${teamStats.skipped}`,
	]
	if (force) {
		lines.push('Overwrite mode: enabled (--force)')
	}
	lines.push(
		'',
		'Next steps:',
		'1) Fill .clawlab/docs/research_brief.json',
		'2) Update .clawlab/tasks/tasks.json',
		'3) Start mission with /research start ...',
	)

	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

async function parseMissionInput(tokens: string[]): Promise<ResearchMissionInput> {
	const input: ResearchMissionInput = {
		topic: '',
		missionType: 'new_project',
	}
	const rest: string[] = []
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		const handler = missionOptionHandlers[token]
		if (handler) {
			index = await handler(tokens, index, input)
			continue
		}
		rest.push(token)
	}
	if (rest.length > 0) {
		input.topic = rest.join(' ')
	}
	if (!input.topic && input.missionType === 'existing_project_improvement') {
		input.topic = input.targetMetric
			? `Improve existing project metric: ${input.targetMetric}`
			: input.problemStatement
				? `Improve existing project: ${input.problemStatement}`
				: ''
	}
	return input
}

function formatStatus(status: Awaited<ReturnType<AutoResearchService['status']>>): string {
	const lines = [
		`Session: ${status.sessionId}`,
		`Top-level state: ${status.state.topLevelState}`,
		`Research state: ${status.state.researchState ?? 'n/a'}`,
		`Runtime mode: ${status.state.runtimeMode}`,
		`Current round: ${status.state.currentRound}`,
		`Paused: ${status.state.paused}`,
		`Ready for summarization: ${status.state.readyForSummarization}`,
		`Model connection: ${
			status.state.modelConnection
				? `${status.state.modelConnection.provider} (${status.state.modelConnection.model ?? 'auto'})`
				: 'auto'
		}`,
	]
	if (status.latestReportPath) {
		lines.push(`Latest report: ${status.latestReportPath}`)
	}
	if (status.latestReportPreview) {
		lines.push('')
		lines.push(status.latestReportPreview)
	}
	return lines.join('\n')
}

function resolveSummarizeTypeToken(tail: string[]): string | undefined {
	return tail[0] === 'paper' || tail[0] === 'summary' || tail[0] === 'report' ? tail[0] : tail[1]
}

function resolveSessionId(subcommand: string, tail: string[]): string | undefined {
	if (
		subcommand === 'summarize' &&
		(tail[0] === 'paper' || tail[0] === 'summary' || tail[0] === 'report')
	) {
		return undefined
	}
	return tail[0]
}

async function runStart(cwd: string, tail: string[]): Promise<LocalCommandResult> {
	const input = await parseMissionInput(tail)
	if (!input.topic) {
		throw new Error('research start requires a topic or --config with a topic')
	}
	const service = await AutoResearchService.start(cwd, input)
	const result = await service.run()
	return {
		type: 'text',
		value: [`Started research session ${result.sessionId}`, '', ...result.reports].join('\n\n'),
	}
}

async function runResume(service: AutoResearchService): Promise<LocalCommandResult> {
	const result = await service.resume()
	return {
		type: 'text',
		value: [`Resumed research session ${result.sessionId}`, '', ...result.reports].join('\n\n'),
	}
}

async function runPause(service: AutoResearchService): Promise<LocalCommandResult> {
	const state = await service.pause()
	return {
		type: 'text',
		value: `Paused research session ${state.sessionId} at state ${state.topLevelState}.`,
	}
}

async function runSummarize(
	service: AutoResearchService,
	summarizeTypeToken: string | undefined,
): Promise<LocalCommandResult> {
	const type =
		summarizeTypeToken === 'paper'
			? 'paper_draft'
			: summarizeTypeToken === 'summary'
				? 'summary'
				: 'report'
	const result = await service.summarize(type)
	return {
		type: 'text',
		value: `Wrote ${type} for session ${result.sessionId} to ${result.path}\n\n${result.content}`,
	}
}

async function runArchive(service: AutoResearchService): Promise<LocalCommandResult> {
	const state = await service.archive()
	return {
		type: 'text',
		value: `Archived research session ${state.sessionId}.`,
	}
}

export async function call(args: string, _context: ToolUseContext): Promise<LocalCommandResult> {
	const cwd = getCwd()
	const tokens = tokenize(args)
	const subcommand = tokens[0] ?? 'status'
	const tail = tokens.slice(1)
	const summarizeTypeToken = resolveSummarizeTypeToken(tail)

	if (subcommand === 'setup') {
		return runSetup(cwd, tail)
	}

	if (subcommand === 'team') {
		return runTeamCommand(cwd, tail)
	}

	if (subcommand === 'start') {
		return runStart(cwd, tail)
	}

	const sessionId = resolveSessionId(subcommand, tail)
	const service = await AutoResearchService.load(cwd, sessionId)
	if (!service) {
		return {
			type: 'text',
			value: 'No research session found.',
		}
	}

	if (subcommand === 'resume') {
		return runResume(service)
	}

	if (subcommand === 'pause') {
		return runPause(service)
	}

	if (subcommand === 'summarize') {
		return runSummarize(service, summarizeTypeToken)
	}

	if (subcommand === 'archive') {
		return runArchive(service)
	}

	const status = await service.status()
	return {
		type: 'text',
		value: formatStatus(status),
	}
}
