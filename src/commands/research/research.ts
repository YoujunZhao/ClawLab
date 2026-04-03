import { readFile } from 'node:fs/promises'
import type { ToolUseContext } from '../../Tool.js'
import { AutoResearchService, type ResearchMissionInput } from '../../research/index.js'
import type { LocalCommandResult } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

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

async function parseMissionInput(tokens: string[]): Promise<ResearchMissionInput> {
	const input: ResearchMissionInput = {
		topic: '',
		missionType: 'new_project',
	}
	const rest: string[] = []
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		if (token === '--config') {
			const configPath = tokens[index + 1]
			if (!configPath) throw new Error('--config requires a file path')
			const loaded = JSON.parse(await readFile(configPath, 'utf8')) as ResearchMissionInput
			Object.assign(input, loaded)
			index += 1
			continue
		}
		if (token === '--rounds') {
			const rounds = Number(tokens[index + 1])
			input.budget = {
				...input.budget,
				maxRounds: rounds,
			}
			index += 1
			continue
		}
		if (token === '--mode') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--mode requires new or improve')
			input.missionType =
				value === 'improve' || value === 'existing_project_improvement'
					? 'existing_project_improvement'
					: 'new_project'
			index += 1
			continue
		}
		if (token === '--repo') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--repo requires a path')
			input.repoPath = value
			index += 1
			continue
		}
		if (token === '--problem') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--problem requires text')
			input.problemStatement = value
			index += 1
			continue
		}
		if (token === '--goal') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--goal requires text')
			input.improvementGoal = value
			index += 1
			continue
		}
		if (token === '--baseline') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--baseline requires text')
			input.baselineSummary = value
			index += 1
			continue
		}
		if (token === '--target-metric') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--target-metric requires a metric name')
			input.targetMetric = value
			index += 1
			continue
		}
		if (token === '--current-metric') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--current-metric requires name=value')
			const [name, parsed] = parseMetricAssignment(value)
			input.currentMetricsSnapshot = {
				...input.currentMetricsSnapshot,
				[name]: parsed,
			}
			index += 1
			continue
		}
		if (token === '--focus-file') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--focus-file requires a path')
			input.preferredFocusFiles = [...(input.preferredFocusFiles ?? []), value]
			index += 1
			continue
		}
		if (token === '--keyword') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--keyword requires text')
			input.keywords = [...(input.keywords ?? []), value]
			index += 1
			continue
		}
		if (token === '--question') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--question requires text')
			input.targetQuestions = [...(input.targetQuestions ?? []), value]
			index += 1
			continue
		}
		if (token === '--model-provider') {
			const value = tokens[index + 1]
			if (!value) {
				throw new Error(
					'--model-provider requires auto, stub, anthropic-oauth, anthropic-api-key, or openai-compatible',
				)
			}
			input.modelConnection = {
				...(input.modelConnection ?? {
					provider: 'auto',
					taskModels: {},
				}),
				provider:
					value === 'anthropic-oauth'
						? 'anthropic_oauth'
						: value === 'anthropic-api-key'
							? 'anthropic_api_key'
							: value === 'openai-compatible'
								? 'openai_compatible'
								: value === 'stub'
									? 'stub'
									: 'auto',
			}
			index += 1
			continue
		}
		if (token === '--model') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--model requires a model name')
			input.modelConnection = {
				...(input.modelConnection ?? {
					provider: 'auto',
					taskModels: {},
				}),
				model: value,
			}
			index += 1
			continue
		}
		if (token === '--task-model') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--task-model requires task=model')
			const [task, model] = parseTaskModelAssignment(value)
			input.modelConnection = {
				...(input.modelConnection ?? {
					provider: 'auto',
					taskModels: {},
				}),
				taskModels: {
					...(input.modelConnection?.taskModels ?? {}),
					[task]: model,
				},
			}
			index += 1
			continue
		}
		if (token === '--model-base-url') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--model-base-url requires a URL')
			input.modelConnection = {
				...(input.modelConnection ?? {
					provider: 'auto',
					taskModels: {},
				}),
				baseUrl: value,
			}
			index += 1
			continue
		}
		if (token === '--model-api-key-env') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--model-api-key-env requires an env var name')
			input.modelConnection = {
				...(input.modelConnection ?? {
					provider: 'auto',
					taskModels: {},
				}),
				apiKeyEnvVar: value,
			}
			index += 1
			continue
		}
		if (token === '--model-display-name') {
			const value = tokens[index + 1]
			if (!value) throw new Error('--model-display-name requires text')
			input.modelConnection = {
				...(input.modelConnection ?? {
					provider: 'auto',
					taskModels: {},
				}),
				displayName: value,
			}
			index += 1
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

export async function call(args: string, _context: ToolUseContext): Promise<LocalCommandResult> {
	const cwd = getCwd()
	const tokens = tokenize(args)
	const subcommand = tokens[0] ?? 'status'
	const tail = tokens.slice(1)
	const summarizeTypeToken =
		tail[0] === 'paper' || tail[0] === 'summary' || tail[0] === 'report' ? tail[0] : tail[1]

	if (subcommand === 'start') {
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

	const sessionId =
		subcommand === 'summarize' &&
		(tail[0] === 'paper' || tail[0] === 'summary' || tail[0] === 'report')
			? undefined
			: tail[0]
	const service = await AutoResearchService.load(cwd, sessionId)
	if (!service) {
		return {
			type: 'text',
			value: 'No research session found.',
		}
	}

	if (subcommand === 'resume') {
		const result = await service.resume()
		return {
			type: 'text',
			value: [`Resumed research session ${result.sessionId}`, '', ...result.reports].join('\n\n'),
		}
	}

	if (subcommand === 'pause') {
		const state = await service.pause()
		return {
			type: 'text',
			value: `Paused research session ${state.sessionId} at state ${state.topLevelState}.`,
		}
	}

	if (subcommand === 'summarize') {
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

	if (subcommand === 'archive') {
		const state = await service.archive()
		return {
			type: 'text',
			value: `Archived research session ${state.sessionId}.`,
		}
	}

	const status = await service.status()
	return {
		type: 'text',
		value: formatStatus(status),
	}
}
