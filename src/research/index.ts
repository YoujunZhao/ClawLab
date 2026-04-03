import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolRunner } from './agents/researchAgents.js'
import { createResearchId } from './core/ids.js'
import { ResearchRuntime } from './core/runtime/researchRuntime.js'
import type {
	BestSoFarArtifact,
	MetricSnapshot,
	MissionArtifact,
	MissionMode,
	ResearchModelConnection,
	ResearchSessionState,
} from './core/schemas.js'
import { ResearchStateMachine } from './core/state-machine/researchStateMachine.js'
import type { ResearchTool } from './core/tool-registry/toolRegistry.js'
import { registerResearchTools } from './tools/researchTools.js'
import { BranchManager } from './workflows/branch-manager.js'
import { ResearchLoop, type ResearchMissionInput } from './workflows/research-loop.js'
import { SummarizationLoop } from './workflows/summarization-loop.js'

async function readTextIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf8')
	} catch {
		return null
	}
}

function buildMissionArtifact(
	repoRoot: string,
	input: ResearchMissionInput & {
		missionType?: MissionMode
		currentMetricsSnapshot?: MetricSnapshot
		modelConnection?: ResearchModelConnection
	},
): MissionArtifact {
	const now = new Date().toISOString()
	return {
		id: createResearchId('mission'),
		missionType: input.missionType ?? 'new_project',
		topic: input.topic,
		title: input.topic,
		objective:
			input.missionType === 'existing_project_improvement'
				? `Auto Research Loop mission to improve an existing project for ${input.topic}`
				: `Auto Research Loop mission for ${input.topic}`,
		problemStatement: input.problemStatement,
		baselineSummary: input.baselineSummary,
		improvementGoal: input.improvementGoal,
		targetMetric: input.targetMetric,
		currentMetricsSnapshot: input.currentMetricsSnapshot ?? {},
		preferredFocusFiles: input.preferredFocusFiles ?? [],
		constraints: input.constraints ?? [],
		repoPath: input.repoPath ?? repoRoot,
		computeBudget: input.budget,
		metrics: input.metrics ?? [],
		successCriteria: input.successCriteria ?? [],
		modelConnection: input.modelConnection,
		createdAt: now,
		updatedAt: now,
	}
}

function sanitizeMissionInputForStorage(input: ResearchMissionInput): Record<string, unknown> {
	return {
		...input,
		remoteMachines: input.remoteMachines?.map((machine) => ({
			...machine,
			password: undefined,
		})),
	}
}

export class AutoResearchService {
	private readonly branchManager: BranchManager
	private readonly runTool: ToolRunner
	private readonly researchLoop: ResearchLoop
	private readonly summarizationLoop: SummarizationLoop

	private constructor(
		private readonly runtime: ResearchRuntime,
		private readonly initialInput: ResearchMissionInput,
	) {
		this.branchManager = new BranchManager(runtime.repoRoot, runtime.artifactStore)
		this.runTool = async <Input, Output>(
			name: string,
			input: Input,
			roundId: string,
			branchId?: string,
		): Promise<Output> => {
			const tool = this.runtime.toolRegistry.get(name)
			if (!tool) {
				throw new Error(`Unknown research tool: ${name}`)
			}
			this.runtime.permissionEngine.assertCanRun(tool)
			return (tool as ResearchTool<typeof input, unknown>).run(
				input,
				this.runtime.buildToolContext(roundId, branchId),
			) as Promise<Output>
		}
		registerResearchTools({
			runtime: this.runtime,
			branchManager: this.branchManager,
		})
		this.researchLoop = new ResearchLoop(this.runtime, this.branchManager, {
			runTool: this.runTool,
			runModel: (task, prompt) => this.runtime.modelRouter.route(task, prompt),
		})
		this.summarizationLoop = new SummarizationLoop(this.runTool, (task, prompt) =>
			this.runtime.modelRouter.route(task, prompt),
		)
	}

	static async start(repoRoot: string, input: ResearchMissionInput): Promise<AutoResearchService> {
		const mission = buildMissionArtifact(repoRoot, input)
		const runtime = await ResearchRuntime.create({
			repoRoot,
			mission,
			remoteMachines: input.remoteMachines,
			modelConnection: input.modelConnection,
		})
		const service = new AutoResearchService(runtime, input)
		await runtime.artifactStore.writeJson(
			'state/mission-input.json',
			sanitizeMissionInputForStorage(input),
		)
		await service.researchLoop.initializeMission(input)
		return service
	}

	static async load(repoRoot: string, sessionId?: string): Promise<AutoResearchService | null> {
		const runtime = sessionId
			? await ResearchRuntime.load(repoRoot, sessionId)
			: await ResearchRuntime.loadLatest(repoRoot)
		if (!runtime) {
			return null
		}
		const storedInput = (await runtime.artifactStore.readJson<ResearchMissionInput>(
			'state/mission-input.json',
		)) ?? {
			topic: runtime.state.topic,
		}
		return new AutoResearchService(runtime, storedInput)
	}

	async run(): Promise<{ sessionId: string; reports: string[] }> {
		const result = await this.researchLoop.run(this.initialInput)
		return {
			sessionId: this.runtime.state.sessionId,
			reports: result.reports,
		}
	}

	async pause(): Promise<ResearchSessionState> {
		await this.runtime.updateState((state) => ({
			...state,
			paused: true,
			stopRequested: true,
			topLevelState: 'PAUSED',
		}))
		return this.runtime.state
	}

	async resume(): Promise<{ sessionId: string; reports: string[] }> {
		await this.runtime.updateState((state) => ({
			...state,
			paused: false,
			stopRequested: false,
			waitingForResources: false,
			topLevelState: 'RESEARCH_LOOP',
		}))
		return this.run()
	}

	async summarize(type: 'summary' | 'report' | 'paper_draft'): Promise<{
		sessionId: string
		path: string
		content: string
	}> {
		const reportFiles = (await this.runtime.artifactStore.list('reports'))
			.filter((file) => file.endsWith('.md'))
			.sort()
		const reportContents = (
			await Promise.all(
				reportFiles.map((file) =>
					readTextIfExists(join(this.runtime.artifactStore.paths.reports, file)),
				),
			)
		).filter((value): value is string => Boolean(value))
		const bestSoFar = await this.runtime.artifactStore.readJson<BestSoFarArtifact>(
			'results/best_so_far_update.json',
		)
		await this.runtime.updateState((state) => ({
			...state,
			userApprovedSummarization: true,
			topLevelState: 'FINAL_SUMMARIZATION',
			finalSummarizationState: 'SUMMARY_PLANNING',
			runtimeMode: 'SUMMARIZE_MODE',
		}))
		const result = await this.summarizationLoop.run({
			roundId: `summary_${Date.now()}`,
			missionTopic: this.runtime.state.topic,
			type,
			roundReports: reportContents,
			bestSoFar: bestSoFar ?? undefined,
			onPhaseChange: async (phase) => {
				await this.runtime.updateState((state) => {
					const machine = new ResearchStateMachine(state)
					return {
						...machine.transitionFinal(phase),
						topLevelState: 'FINAL_SUMMARIZATION',
					}
				})
			},
		})
		await this.runtime.updateState((state) => ({
			...state,
			topLevelState: 'READY_FOR_SUMMARIZATION',
			finalSummarizationState: 'FINAL_OUTPUT_READY',
		}))
		return {
			sessionId: this.runtime.state.sessionId,
			path: result.path,
			content: result.content,
		}
	}

	async archive(): Promise<ResearchSessionState> {
		await this.runtime.updateState((state) => ({
			...state,
			topLevelState: 'ARCHIVED',
			stopRequested: true,
		}))
		return this.runtime.state
	}

	async status(): Promise<{
		sessionId: string
		state: ResearchSessionState
		latestReportPath?: string
		latestReportPreview?: string
	}> {
		const reportFiles = (await this.runtime.artifactStore.list('reports'))
			.filter((file) => file.endsWith('.md'))
			.sort()
		const latestReportPath =
			reportFiles.length > 0
				? join(this.runtime.artifactStore.paths.reports, reportFiles.at(-1)!)
				: undefined
		const latestReportPreview = latestReportPath
			? (await readTextIfExists(latestReportPath))?.slice(0, 2000)
			: undefined
		return {
			sessionId: this.runtime.state.sessionId,
			state: this.runtime.state,
			latestReportPath,
			latestReportPreview,
		}
	}
}

export type { ResearchMissionInput }
