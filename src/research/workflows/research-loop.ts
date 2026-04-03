import {
	CriticAgent,
	EngineerAgent,
	PIAgent,
	ReaderAgent,
	RunnerAgent,
	ScoutAgent,
	type ToolRunner,
} from '../agents/researchAgents.js'
import { createResearchId, createRoundLabel, createRunLabel } from '../core/ids.js'
import type { ModelResponse, ModelTask } from '../core/model-router/modelRouter.js'
import type { ResearchRuntime } from '../core/runtime/researchRuntime.js'
import type {
	BestSoFarArtifact,
	BranchRecord,
	Budget,
	ExecutionTarget,
	ExperimentPlan,
	Hypothesis,
	MetricSnapshot,
	MissionArtifact,
	MissionMode,
	NextAction,
	PatchResult,
	RemoteMachineConfig,
	ResearchIndexArtifact,
	ResearchModelConnection,
	ResearchSessionState,
	ResearchTask,
	SuccessCriterion,
	UserRoundReport,
} from '../core/schemas.js'
import { ResearchStateMachine } from '../core/state-machine/researchStateMachine.js'
import { TraceLogger } from '../core/trace/traceLogger.js'
import type { BranchManager } from './branch-manager.js'
import { ReportingLoop } from './reporting-loop.js'

function nowIso(): string {
	return new Date().toISOString()
}

export type ResearchMissionInput = {
	topic: string
	missionType?: MissionMode
	repoPath?: string
	problemStatement?: string
	baselineSummary?: string
	improvementGoal?: string
	targetMetric?: string
	currentMetricsSnapshot?: MetricSnapshot
	preferredFocusFiles?: string[]
	constraints?: string[]
	metrics?: string[]
	successCriteria?: SuccessCriterion[]
	budget?: Budget
	keywords?: string[]
	targetQuestions?: string[]
	remoteMachines?: RemoteMachineConfig[]
	executionTarget?: ExecutionTarget
	modelConnection?: ResearchModelConnection
	smokeCommands?: string[]
	shortRunCommand?: string
	fullRunCommand?: string
}

function buildMissionObjective(input: ResearchMissionInput): string {
	if (input.missionType === 'existing_project_improvement') {
		const targetMetric = input.targetMetric ? ` for ${input.targetMetric}` : ''
		const problem = input.problemStatement ? ` while addressing: ${input.problemStatement}` : ''
		return `Continuously improve an existing project${targetMetric}${problem}`
	}
	return `Continuously research, patch, validate, experiment, debug, reflect, and report on ${input.topic}`
}

function buildMissionMarkdown(mission: MissionArtifact): string {
	const metrics = mission.metrics.length > 0 ? mission.metrics.join(', ') : 'Not specified'
	const successCriteria =
		mission.successCriteria.length > 0
			? mission.successCriteria
					.map(
						(criteria) =>
							`${criteria.name} (${criteria.direction}${criteria.target !== undefined ? ` ${criteria.target}` : ''})`,
					)
					.join('\n')
			: 'No explicit success criteria provided yet.'
	const currentMetrics =
		Object.keys(mission.currentMetricsSnapshot).length > 0
			? Object.entries(mission.currentMetricsSnapshot)
					.map(([name, value]) => `  - ${name}: ${value}`)
					.join('\n')
			: '  - Not provided'
	const focusFiles =
		mission.preferredFocusFiles.length > 0
			? mission.preferredFocusFiles.map((file) => `  - ${file}`).join('\n')
			: '  - No explicit focus files provided'
	const constraints =
		mission.constraints.length > 0
			? mission.constraints.map((item) => `  - ${item}`).join('\n')
			: '  - No extra constraints provided'
	const modelConnection = mission.modelConnection
		? [
				`  - Provider: ${mission.modelConnection.provider}`,
				`  - Default Model: ${mission.modelConnection.model ?? 'auto'}`,
				`  - Base URL: ${mission.modelConnection.baseUrl ?? 'provider default'}`,
				`  - API Key Env: ${mission.modelConnection.apiKeyEnvVar ?? 'provider default'}`,
			].join('\n')
		: '  - Auto-detect CLI OAuth, Anthropic API key, or fall back to stub mode'
	return [
		'# Mission',
		'',
		`- Mode: ${mission.missionType}`,
		`- Topic: ${mission.topic}`,
		`- Objective: ${mission.objective}`,
		`- Repo: ${mission.repoPath ?? 'current workspace'}`,
		`- Metrics: ${metrics}`,
		`- Problem Statement: ${mission.problemStatement ?? 'Not specified'}`,
		`- Target Metric: ${mission.targetMetric ?? 'Not specified'}`,
		`- Improvement Goal: ${mission.improvementGoal ?? 'Not specified'}`,
		`- Baseline Summary: ${mission.baselineSummary ?? 'Not specified'}`,
		'',
		'## Current Metrics Snapshot',
		currentMetrics,
		'',
		'## Preferred Focus Files',
		focusFiles,
		'',
		'## Constraints',
		constraints,
		'',
		'## Model Connection',
		modelConnection,
		'',
		'## Success Criteria',
		successCriteria,
	].join('\n')
}

function buildHypotheses(input: {
	topic: string
	missionType: MissionMode
	evidenceClaims: string[]
	problemStatement?: string
	targetMetric?: string
	currentMetricsSnapshot?: MetricSnapshot
}): Hypothesis[] {
	const claims = input.evidenceClaims.slice(0, 3)
	if (input.missionType === 'existing_project_improvement') {
		const currentMetricSummary =
			input.targetMetric && input.currentMetricsSnapshot?.[input.targetMetric] !== undefined
				? ` Current ${input.targetMetric}=${input.currentMetricsSnapshot[input.targetMetric]}.`
				: ''
		claims.unshift(
			`Improve the existing project's ${
				input.targetMetric ?? 'primary metric'
			} by targeting the likely bottleneck.${currentMetricSummary} ${
				input.problemStatement ?? 'Metric progress has plateaued.'
			}`.trim(),
		)
	}
	if (claims.length === 0) {
		claims.push(`Improve measurable behavior for ${input.topic} with tighter instrumentation`)
	}
	return claims.map((claim, index) => ({
		id: createResearchId('hyp'),
		description: claim,
		whyNow:
			index === 0
				? 'This direction aligns with the strongest evidence collected this round.'
				: 'This direction remains plausible and cheap enough to probe next.',
		evidenceLinks: [],
		expectedGain:
			index === 0
				? 'Clarify the best-so-far path or surface a measurable quality signal.'
				: 'Reduce uncertainty around an alternative path.',
		risk:
			index === 0
				? 'May only improve observability instead of core task quality.'
				: 'Could consume validation budget without clear gains.',
		minimalTest:
			index === 0
				? 'Add or refine instrumentation/configuration, then run a smoke + short run.'
				: 'Probe with a short, reversible branch-isolated patch and compare metrics.',
		confidence: Math.max(0.45, 0.8 - index * 0.15),
		branchKind: index === 0 ? 'mainline' : index === 1 ? 'exploration' : 'repair',
		status: 'candidate',
	}))
}

function chooseExecutionTarget(
	repoPath: string,
	explicitTarget: ExecutionTarget | undefined,
	remoteMachines: RemoteMachineConfig[],
	branchWorktreePath: string,
): ExecutionTarget {
	if (explicitTarget) {
		return explicitTarget
	}
	if (remoteMachines.length > 0) {
		const machine = remoteMachines[0]
		return {
			type: 'ssh',
			machineId: machine.id,
			cwd: machine.remoteWorkspace,
			gpuAllocation: {
				mode: 'manual',
				visibleDevices: '0',
				requiredGpuCount: 1,
			},
		}
	}
	return {
		type: 'local',
		cwd: branchWorktreePath || repoPath,
		gpuAllocation: {
			mode: 'auto',
		},
	}
}

function buildValidationCommands(
	repoCommands: string[],
	smokeCommands: string[] | undefined,
): string[] {
	const checks = [
		repoCommands.find((command) => /typecheck|tsc|mypy|pyright/iu.test(command)),
		repoCommands.find((command) => /lint/iu.test(command)),
		repoCommands.find((command) => /test/iu.test(command)),
		repoCommands.find((command) => /build|dry/iu.test(command)),
		...(smokeCommands ?? ['pwd']),
	].filter((value): value is string => Boolean(value))
	return Array.from(new Set(checks))
}

function defaultTargetQuestions(input: ResearchMissionInput): string[] {
	if (input.targetQuestions && input.targetQuestions.length > 0) {
		return input.targetQuestions
	}
	if (input.missionType === 'existing_project_improvement') {
		return [
			`What is limiting ${input.targetMetric ?? 'the target metric'} in the current project?`,
			'Which repo files or configs most directly control the observed bottleneck?',
			'What low-risk patch can validate a metric-improvement hypothesis before a full run?',
		]
	}
	return [
		'What baseline should this repo be compared against?',
		'What metric or benchmark best captures success?',
		'What failure modes are already visible in the codebase or literature?',
	]
}

function buildImprovementBrief(input: ResearchMissionInput): Record<string, unknown> {
	return {
		missionType: input.missionType ?? 'new_project',
		topic: input.topic,
		repoPath: input.repoPath,
		problemStatement: input.problemStatement,
		baselineSummary: input.baselineSummary,
		improvementGoal: input.improvementGoal,
		targetMetric: input.targetMetric,
		currentMetricsSnapshot: input.currentMetricsSnapshot ?? {},
		preferredFocusFiles: input.preferredFocusFiles ?? [],
		constraints: input.constraints ?? [],
		targetQuestions: defaultTargetQuestions(input),
		modelConnection: input.modelConnection,
	}
}

function buildSafetyChecklist(input: ResearchMissionInput): Record<string, unknown> {
	return {
		executesModelWrittenCode: true,
		missionType: input.missionType ?? 'new_project',
		usesRemoteExecution: (input.remoteMachines?.length ?? 0) > 0,
		recommendations: [
			'Prefer isolated environments for code execution.',
			'Verify dataset and credential paths before long-running experiments.',
			'Use branch-isolated worktrees for each hypothesis.',
			'Apply smoke checks before short and full runs.',
			'Review remote host, environment name, and CUDA_VISIBLE_DEVICES before GPU jobs.',
		],
		remoteExecutionNotes:
			(input.remoteMachines?.length ?? 0) > 0
				? [
						'Confirm SSH auth is valid before starting background jobs.',
						'Treat remote logs, artifacts, and checkpoints as mission data that should be collected and audited.',
					]
				: ['No remote machine configured for this mission.'],
	}
}

function formatResearchIndex(index: ResearchIndexArtifact): string {
	const branchLines =
		index.activeBranches.length > 0
			? index.activeBranches
					.map((branch) => `- ${branch.name} (${branch.kind}, ${branch.status})`)
					.join('\n')
			: '- none'
	const nextActionLines =
		index.nextActions.length > 0
			? index.nextActions.map((action) => `- ${action.title} [${action.kind}]`).join('\n')
			: '- none'
	return [
		'# Research Index',
		'',
		`- Session ID: ${index.sessionId}`,
		`- Mission ID: ${index.missionId}`,
		`- Mission Type: ${index.missionType}`,
		`- Topic: ${index.topic}`,
		`- Problem Statement: ${index.problemStatement ?? 'Not specified'}`,
		`- Target Metric: ${index.targetMetric ?? 'Not specified'}`,
		`- Current Round: ${index.currentRound}`,
		`- Top-level State: ${index.topLevelState}`,
		`- Research State: ${index.researchState ?? 'n/a'}`,
		`- Latest Round ID: ${index.latestRoundId ?? 'n/a'}`,
		`- Latest Report Path: ${index.latestReportPath ?? 'n/a'}`,
		`- Best So Far: ${index.bestSoFarSummary ?? 'n/a'}`,
		'',
		'## Active Branches',
		branchLines,
		'',
		'## Next Actions',
		nextActionLines,
	].join('\n')
}

export class ResearchLoop {
	private readonly pi = new PIAgent(this.deps)
	private readonly scout = new ScoutAgent(this.deps)
	private readonly reader = new ReaderAgent(this.deps)
	private readonly engineer = new EngineerAgent(this.deps)
	private readonly runner = new RunnerAgent(this.deps)
	private readonly critic = new CriticAgent()
	private readonly reporting: ReportingLoop
	private readonly trace: TraceLogger

	constructor(
		private readonly runtime: ResearchRuntime,
		private readonly branchManager: BranchManager,
		private readonly deps: {
			runTool: ToolRunner
			runModel?: (task: ModelTask, prompt: string) => Promise<ModelResponse>
		},
	) {
		this.reporting = new ReportingLoop(deps.runTool)
		this.trace = new TraceLogger(runtime.artifactStore)
	}

	async initializeMission(input: ResearchMissionInput): Promise<void> {
		const machine = new ResearchStateMachine(this.runtime.state)
		this.runtime.state = machine.transitionTopLevel('MISSION_FRAMING')
		const mission: MissionArtifact = {
			id: this.runtime.state.missionId,
			missionType: input.missionType ?? 'new_project',
			topic: input.topic,
			title: input.topic,
			objective: buildMissionObjective(input),
			problemStatement: input.problemStatement,
			baselineSummary: input.baselineSummary,
			improvementGoal: input.improvementGoal,
			targetMetric: input.targetMetric,
			currentMetricsSnapshot: input.currentMetricsSnapshot ?? {},
			preferredFocusFiles: input.preferredFocusFiles ?? [],
			constraints: input.constraints ?? [],
			repoPath: input.repoPath ?? this.runtime.repoRoot,
			computeBudget: input.budget,
			metrics: input.metrics ?? [],
			successCriteria: input.successCriteria ?? [],
			modelConnection: input.modelConnection ?? this.runtime.state.modelConnection,
			createdAt: this.runtime.state.createdAt,
			updatedAt: nowIso(),
		}
		await this.runtime.persistMissionArtifacts({
			missionMarkdown: buildMissionMarkdown(mission),
			successCriteria: {
				missionId: mission.id,
				criteria: mission.successCriteria,
			},
			budget: mission.computeBudget ?? {},
		})
		await this.runtime.artifactStore.writeJson(
			'mission/improvement_brief.json',
			buildImprovementBrief(input),
		)
		await this.runtime.artifactStore.writeJson(
			'mission/safety_checklist.json',
			buildSafetyChecklist(input),
		)
		await this.runtime.artifactStore.writeJson(
			'mission/model_connection.json',
			this.runtime.modelRouter.describe(),
		)
		const loopMachine = new ResearchStateMachine(this.runtime.state)
		await this.runtime.updateState((state) => ({
			...loopMachine.transitionTopLevel('RESEARCH_LOOP'),
			repoPath: mission.repoPath ?? state.repoPath,
			modelConnection: mission.modelConnection ?? state.modelConnection,
		}))
		await this.trace.log({
			type: 'mission_initialized',
			data: {
				topic: input.topic,
				repoPath: mission.repoPath,
			},
		})
	}

	async run(input: ResearchMissionInput): Promise<{
		reports: string[]
		latestState: ResearchSessionState
	}> {
		const reports: string[] = []
		const maxRounds = input.budget?.maxRounds ?? this.runtime.state.budget?.maxRounds ?? 2
		let consecutiveNoProgress = 0
		while (this.shouldContinue(maxRounds, consecutiveNoProgress)) {
			const result = await this.runSingleRound(input)
			reports.push(result.reportContent)
			consecutiveNoProgress = result.progressMade ? 0 : consecutiveNoProgress + 1
			if (result.readyForSummarization) {
				await this.runtime.updateState((state) => ({
					...state,
					readyForSummarization: true,
				}))
			}
			if (consecutiveNoProgress >= 3) {
				await this.runtime.updateState((state) => ({
					...state,
					topLevelState: 'WAITING_FOR_RESOURCES',
					waitingForResources: true,
					notes: [...state.notes, 'Entered waiting mode after repeated non-improving rounds'],
				}))
				break
			}
		}
		return {
			reports,
			latestState: this.runtime.state,
		}
	}

	private shouldContinue(maxRounds: number, consecutiveNoProgress: number): boolean {
		if (this.runtime.state.stopRequested || this.runtime.state.paused) {
			return false
		}
		if (this.runtime.state.currentRound >= maxRounds) {
			return false
		}
		if (this.runtime.state.budget?.wallClockMinutes) {
			const startedAt = Date.parse(this.runtime.state.budgetUsage.startedAt)
			const elapsedMinutes = (Date.now() - startedAt) / 60_000
			if (elapsedMinutes >= this.runtime.state.budget.wallClockMinutes) {
				return false
			}
		}
		if (consecutiveNoProgress >= 3) {
			return false
		}
		return true
	}

	private async runSingleRound(input: ResearchMissionInput): Promise<{
		reportContent: string
		progressMade: boolean
		readyForSummarization: boolean
	}> {
		const remoteMachines =
			this.runtime.state.remoteMachines.length > 0
				? this.runtime.state.remoteMachines
				: (input.remoteMachines ?? [])
		const roundNumber = this.runtime.state.currentRound + 1
		const roundId = createRoundLabel(roundNumber)
		const task = await this.createRoundTask(roundId)
		const stateMachine = new ResearchStateMachine(this.runtime.state)
		await this.runtime.updateState((state) => ({
			...stateMachine.transitionResearch('RESEARCHING'),
			currentRound: roundNumber,
			topLevelState: 'RESEARCH_LOOP',
			waitingForResources: false,
			paused: false,
			budgetUsage: {
				...state.budgetUsage,
				roundsCompleted: roundNumber,
			},
		}))
		await this.trace.log({ type: 'round_started', roundId })
		await this.deps.runTool('enter_plan_mode', {}, roundId)

		const scouted = await this.scout.scout({
			roundId,
			topic: input.topic,
			keywords: input.keywords ?? [],
			repoContext: this.runtime.repoRoot,
			targetQuestions: defaultTargetQuestions(input),
		})
		await this.runtime.artifactStore.writeJson('sources/repo_candidates.json', [
			{
				id: createResearchId('repo'),
				name: this.runtime.state.topic,
				path: input.repoPath ?? this.runtime.repoRoot,
				notes:
					input.missionType === 'existing_project_improvement'
						? 'Existing project selected for automated improvement research'
						: 'Primary working repository for the current mission',
				score: 1,
			},
		])
		await this.runtime.updateState((state) => ({
			...state,
			budgetUsage: {
				...state.budgetUsage,
				searchesUsed: state.budgetUsage.searchesUsed + 1,
			},
		}))

		const readerOutput = await this.reader.read({
			roundId,
			targetQuestion: input.topic,
			sources: scouted.sourceRefs.map((source) => ({
				...source,
				snippet: scouted.sourceSummaries.find((summary) => summary.startsWith(source.title)),
			})),
		})

		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'FORMING_HYPOTHESES',
		}))

		const hypotheses = buildHypotheses({
			topic: input.topic,
			missionType: input.missionType ?? 'new_project',
			evidenceClaims: readerOutput.extractedClaims,
			problemStatement: input.problemStatement,
			targetMetric: input.targetMetric,
			currentMetricsSnapshot: input.currentMetricsSnapshot,
		})
		for (const hypothesis of hypotheses) {
			await this.runtime.artifactStore.appendJsonl('results/hypotheses.jsonl', hypothesis)
		}

		const piPlan = await this.pi.planRound({
			roundId,
			missionTopic: input.topic,
			currentBestSummary: (
				await this.runtime.artifactStore.readJson<BestSoFarArtifact>(
					'results/best_so_far_update.json',
				)
			)?.summary,
			recentFailures: [],
			openQuestions: defaultTargetQuestions(input),
			hypotheses,
		})

		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'BRANCH_SELECTION',
		}))

		const branchResult = await this.deps.runTool<
			{ action: 'ensure'; preferredKind: Hypothesis['branchKind']; hypothesis: Hypothesis },
			{ branch: BranchRecord }
		>(
			'worktree_manager',
			{
				action: 'ensure',
				preferredKind: piPlan.selectedBranchKind,
				hypothesis:
					hypotheses.find((hypothesis) => piPlan.selectedHypothesisIds.includes(hypothesis.id)) ??
					hypotheses[0],
			},
			roundId,
		)
		const branch = branchResult.branch

		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'PLANNING_PATCH',
		}))

		const plan = this.engineer.createPatchPlan({
			hypothesis:
				hypotheses.find((hypothesis) => piPlan.selectedHypothesisIds.includes(hypothesis.id)) ??
				hypotheses[0],
			repoSummary: scouted.repoSummary,
			keyFiles: scouted.keyFiles,
			configs: scouted.configs,
			focusFiles: input.preferredFocusFiles,
		})
		const executionTarget = chooseExecutionTarget(
			input.repoPath ?? this.runtime.repoRoot,
			input.executionTarget,
			remoteMachines,
			branch.worktreePath,
		)
		if (executionTarget.type === 'ssh') {
			const remoteMachine = remoteMachines.find(
				(machine) => machine.id === executionTarget.machineId,
			)
			await this.runtime.artifactStore.writeJson(`remote/${roundId}.json`, {
				roundId,
				remoteHost: remoteMachine?.host ?? executionTarget.machineId,
				remoteCwd: executionTarget.cwd,
				gpuAllocation:
					executionTarget.gpuAllocation?.visibleDevices ??
					executionTarget.gpuAllocation?.mode ??
					'none',
				environmentName: remoteMachine?.pythonEnvName ?? 'unspecified',
			})
		}
		await this.runtime.artifactStore.writeJson('results/patch_plan.json', plan.patchPlan)
		await this.runtime.artifactStore.writeJson('results/validation_plan.json', {
			staticCheckCommands: plan.validationChecklist,
			lintCommands: plan.validationChecklist,
			unitTestCommands: plan.validationChecklist,
			dryRunCommands: plan.validationChecklist,
			smokeRunCommands: input.smokeCommands ?? ['pwd'],
		})
		await this.runtime.artifactStore.writeJson(
			'results/execution_target.json',
			executionTarget as unknown as Record<string, unknown>,
		)

		await this.deps.runTool('exit_plan_mode', {}, roundId, branch.id)
		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'PATCHING',
			activeBranchId: branch.id,
			runtimeMode: 'EXECUTION_MODE',
		}))

		const patchResultInfo = await this.engineer.applyPatch({
			roundId,
			branch,
			patchPlan: plan.patchPlan,
		})
		const patchResult: PatchResult = {
			id: patchResultInfo.patchResultId,
			patchPlanId: plan.patchPlan.id,
			filesChanged: patchResultInfo.filesChanged,
			diffSummary: patchResultInfo.diffSummary,
			success: true,
		}
		await this.runtime.updateState((state) => ({
			...state,
			budgetUsage: {
				...state.budgetUsage,
				patchesUsed: state.budgetUsage.patchesUsed + 1,
			},
		}))
		await this.runtime.artifactStore.writeJson(
			'results/patch_summary.json',
			patchResult as unknown as Record<string, unknown>,
		)

		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'VALIDATING',
		}))
		const validationCommands = buildValidationCommands(scouted.commands, input.smokeCommands)
		const smoke = await this.deps.runTool<
			{ commands: string[]; executionTarget: ExecutionTarget },
			{
				success: boolean
				checks: Array<{ command: string; success: boolean; stdout?: string; stderr?: string }>
			}
		>(
			'smoke_run',
			{
				commands: validationCommands.length > 0 ? validationCommands : ['pwd'],
				executionTarget,
			},
			roundId,
			branch.id,
		)
		await this.runtime.artifactStore.writeJson(
			`validation_logs/${roundId}.json`,
			smoke as unknown as Record<string, unknown>,
		)

		let failureClass = ''
		let runIds: string[] = []
		let metricHighlights: Record<string, number> = {}
		let experimentsSummary: string[] = []
		const failuresAndFixes: string[] = []

		if (!smoke.success) {
			await this.runtime.updateState((state) => ({
				...state,
				researchState: 'DEBUGGING',
			}))
			const failure = await this.deps.runTool<{ text: string }, { failureClass: string }>(
				'failure_classifier',
				{
					text: smoke.checks.map((check) => `${check.command}\n${check.stderr ?? ''}`).join('\n'),
				},
				roundId,
				branch.id,
			)
			failureClass = failure.failureClass
			failuresAndFixes.push(
				`Validation failed before full experiment. Classified as ${failureClass}.`,
			)
			await this.runtime.memoryStore.noteLoopUpdate({
				failedDirection: plan.patchPlan.intent,
				failureClass,
			})
			await this.runtime.updateState((state) => ({
				...state,
				budgetUsage: {
					...state.budgetUsage,
					debugActionsUsed: state.budgetUsage.debugActionsUsed + 1,
				},
			}))
			await this.deps.runTool(
				'worktree_manager',
				{
					action: 'fail',
					branchId: branch.id,
					note: `Validation failure (${failureClass}) in ${roundId}`,
				},
				roundId,
				branch.id,
			)
		} else {
			await this.runtime.updateState((state) => ({
				...state,
				researchState: 'RUNNING_EXPERIMENT',
			}))
			const experimentPlan: ExperimentPlan = {
				id: createRunLabel(this.runtime.state.budgetUsage.experimentsUsed + 1),
				hypothesisId: plan.patchPlan.hypothesisId,
				branchId: branch.id,
				objective: piPlan.roundObjective,
				variants: [plan.patchPlan.intent],
				controls: validationCommands.slice(0, 2),
				metrics: input.metrics ?? [],
				budget: input.budget,
				stoppingRules: [
					'Stop after smoke + short run if metrics regress or logs indicate instability.',
					'Only continue to full run after a successful short run.',
				],
				expectedOutcome:
					hypotheses[0]?.expectedGain ?? 'Reduce uncertainty or improve best-so-far.',
				executionTarget,
			}
			await this.deps.runTool(
				'experiment_plan_writer',
				{ plan: experimentPlan },
				roundId,
				branch.id,
			)
			const runnerOutput = await this.runner.run({
				roundId,
				branchId: branch.id,
				experimentPlan,
				commandTemplate:
					input.fullRunCommand ?? input.shortRunCommand ?? validationCommands[0] ?? 'pwd',
			})
			runIds = runnerOutput.runIds
			metricHighlights = runnerOutput.metricHighlights
			experimentsSummary = runnerOutput.summaries
			failuresAndFixes.push(
				...runnerOutput.failureClasses.map(
					(currentFailure) => `Experiment issue classified as ${currentFailure}.`,
				),
			)
			await this.runtime.updateState((state) => ({
				...state,
				budgetUsage: {
					...state.budgetUsage,
					experimentsUsed: state.budgetUsage.experimentsUsed + 1,
				},
			}))
			failureClass = runnerOutput.failureClasses[0] ?? ''
			await this.runtime.artifactStore.writeJson(`runs/${roundId}/metrics.json`, metricHighlights)
		}

		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'REFLECTING',
			topLevelState: 'REPORTING',
		}))

		const critic = this.critic.review({
			hypothesis: hypotheses[0],
			runIds,
			patchResult,
			metricHighlights,
		})

		const bestSoFar: BestSoFarArtifact = {
			roundId,
			summary:
				runIds.length > 0
					? `Best-so-far remains on ${branch.name}: ${experimentsSummary[0] ?? 'run launched'}`
					: 'Best-so-far is provisional; this round mainly improved research coverage and debugging signal.',
			branchId: branch.id,
			runId: runIds[0],
			supportingEvidenceIds: readerOutput.evidenceCardIds,
			metrics: metricHighlights,
			updatedAt: nowIso(),
		}

		const nextActions = [
			{
				id: createResearchId('action'),
				kind: piPlan.exploitOrExplore,
				title: `Continue with ${piPlan.exploitOrExplore}`,
				description:
					piPlan.exploitOrExplore === 'repair'
						? 'Repair validation or run stability issues before another full run.'
						: 'Use the new evidence and best-so-far to pick the next small branch-isolated patch.',
				branchId: branch.id,
				hypothesisIds: piPlan.selectedHypothesisIds,
			},
		] satisfies NextAction[]
		await this.runtime.artifactStore.writeJson('results/reflection.json', {
			hypothesisId: hypotheses[0].id,
			roundId,
			outcome: critic.verdict,
			exploitOrExploreNext: piPlan.exploitOrExplore,
			substantialProgress: runIds.length > 0 || patchResult.filesChanged.length > 0,
			bestSoFarImproved: runIds.length > 0,
			nextCandidateHypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
			notes: critic.concerns,
		})
		await this.runtime.artifactStore.writeJson(
			'results/next_actions.json',
			nextActions as unknown as Record<string, unknown>,
		)
		await this.runtime.artifactStore.writeJson('results/updated_branch_plan.json', {
			activeBranchId: branch.id,
			branchKind: branch.kind,
		})
		await this.runtime.artifactStore.writeJson(
			'results/updated_budget_state.json',
			this.runtime.state.budgetUsage as unknown as Record<string, unknown>,
		)
		await this.runtime.artifactStore.writeJson('results/continue_reason.json', {
			reason:
				this.runtime.state.currentRound < (input.budget?.maxRounds ?? 2)
					? 'Default path after reporting is to continue to the next round.'
					: 'Stopped because the configured round budget was reached.',
		})

		const report: UserRoundReport = {
			roundId,
			objective: piPlan.roundObjective,
			researchSummary: [...scouted.repoSummary, ...scouted.sourceSummaries.slice(0, 3)],
			evidenceAdded: readerOutput.extractedClaims.slice(0, 5),
			codeChanges:
				patchResult.filesChanged.length > 0
					? [patchResult.diffSummary]
					: ['No deterministic patch landed; round stayed artifact-driven and branch-isolated.'],
			experimentsRun:
				experimentsSummary.length > 0
					? experimentsSummary
					: ['No full experiment launched because validation failed or resources were gated.'],
			keyResults: [
				...Object.entries(metricHighlights).map(([metric, value]) => `${metric}=${value}`),
				`Critic verdict: ${critic.verdict}`,
			],
			failuresAndFixes:
				failuresAndFixes.length > 0 ? failuresAndFixes : ['No blocking failures in this round.'],
			currentBestSoFar: bestSoFar.summary,
			uncertainties:
				critic.concerns.length > 0
					? critic.concerns
					: ['Metric confidence still needs additional runs.'],
			nextRoundPlan: nextActions.map((action) => action.description),
			executionEnvironmentSummary: [
				`mode: ${executionTarget.type === 'ssh' ? 'remote' : 'local'}`,
				`remote host: ${
					executionTarget.type === 'ssh'
						? (remoteMachines.find((machine) => machine.id === executionTarget.machineId)?.host ??
							executionTarget.machineId ??
							'n/a')
						: 'n/a'
				}`,
				`GPU allocation: ${executionTarget.gpuAllocation?.visibleDevices ?? executionTarget.gpuAllocation?.mode ?? 'none'}`,
				`environment name: ${
					executionTarget.type === 'ssh'
						? (remoteMachines.find((machine) => machine.id === executionTarget.machineId)
								?.pythonEnvName ?? 'unspecified')
						: 'local/default'
				}`,
				`working directory: ${executionTarget.cwd}`,
			],
		}

		const reportResult = await this.reporting.writeRoundReport(roundId, report, bestSoFar)
		const branches = await this.branchManager.list()
		const researchIndex: ResearchIndexArtifact = {
			sessionId: this.runtime.state.sessionId,
			missionId: this.runtime.state.missionId,
			missionType: input.missionType ?? 'new_project',
			topic: input.topic,
			problemStatement: input.problemStatement,
			targetMetric: input.targetMetric,
			currentRound: roundNumber,
			topLevelState: 'REPORTING',
			researchState: 'RESEARCH_ROUND_DONE',
			latestRoundId: roundId,
			latestReportPath: reportResult.reportPath,
			bestSoFarSummary: bestSoFar.summary,
			activeBranches: branches.map((currentBranch) => ({
				id: currentBranch.id,
				name: currentBranch.name,
				kind: currentBranch.kind,
				status: currentBranch.status,
			})),
			nextActions: nextActions.map((action) => ({
				id: action.id,
				kind: action.kind,
				title: action.title,
				branchId: action.branchId,
			})),
			updatedAt: nowIso(),
		}
		await this.runtime.artifactStore.writeJson('results/research_index.json', researchIndex)
		await this.runtime.artifactStore.writeText(
			'reports/research_index.md',
			formatResearchIndex(researchIndex),
		)
		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'RESEARCH_ROUND_DONE',
			topLevelState: 'REPORTING',
			latestBestSoFarPath: 'results/best_so_far_update.json',
		}))
		await this.runtime.taskStore.update(task.id, {
			status: 'completed',
			phase: 'reporting',
			outputs: {
				reportPath: reportResult.reportPath,
				bestSoFar: bestSoFar.summary,
			},
		})
		await this.trace.log({
			type: 'round_completed',
			roundId,
			data: {
				reportPath: reportResult.reportPath,
			},
		})
		const readyForSummarization =
			runIds.length > 0 && (input.successCriteria?.length ?? 0) === 0
				? roundNumber >= 2
				: Object.keys(metricHighlights).length > 0
		await this.runtime.updateState((state) => ({
			...state,
			topLevelState: readyForSummarization ? 'READY_FOR_SUMMARIZATION' : 'RESEARCH_LOOP',
			researchState: 'RESEARCH_ROUND_DONE',
		}))
		return {
			reportContent: reportResult.content,
			progressMade: runIds.length > 0 || patchResult.filesChanged.length > 0,
			readyForSummarization,
		}
	}

	private async createRoundTask(roundId: string): Promise<ResearchTask> {
		const task: ResearchTask = {
			id: createResearchId('task'),
			type: 'research_round',
			title: `Research round ${roundId}`,
			objective: `Advance research loop for ${this.runtime.state.topic}`,
			status: 'running',
			phase: 'researching',
			createdAt: nowIso(),
			updatedAt: nowIso(),
			budget: this.runtime.state.budget,
			inputs: {},
			outputs: {},
			artifactIds: [],
			nextActionIds: [],
		}
		await this.runtime.taskStore.create(task)
		return task
	}
}
