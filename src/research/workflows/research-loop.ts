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

type SmokeCheck = { command: string; success: boolean; stdout?: string; stderr?: string }

type SmokeRunResult = {
	success: boolean
	checks: SmokeCheck[]
}

type RoundResearchBundle = {
	scouted: Awaited<ReturnType<ScoutAgent['scout']>>
	readerOutput: Awaited<ReturnType<ReaderAgent['read']>>
	hypotheses: Hypothesis[]
	piPlan: Awaited<ReturnType<PIAgent['planRound']>>
}

type RoundPlanBundle = {
	branch: BranchRecord
	plan: ReturnType<EngineerAgent['createPatchPlan']>
	executionTarget: ExecutionTarget
}

type RoundValidationBundle = {
	patchResult: PatchResult
	smoke: SmokeRunResult
	validationCommands: string[]
}

type RoundExecutionOutcome = {
	runIds: string[]
	metricHighlights: Record<string, number>
	experimentsSummary: string[]
	failuresAndFixes: string[]
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

	private async startRound(roundNumber: number, roundId: string): Promise<ResearchTask> {
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
		return task
	}

	private async collectResearchBundle(
		input: ResearchMissionInput,
		roundId: string,
	): Promise<RoundResearchBundle> {
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

		return {
			scouted,
			readerOutput,
			hypotheses,
			piPlan,
		}
	}

	private async prepareRoundPlan(
		input: ResearchMissionInput,
		roundId: string,
		remoteMachines: RemoteMachineConfig[],
		researchBundle: RoundResearchBundle,
	): Promise<RoundPlanBundle> {
		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'BRANCH_SELECTION',
		}))

		const selectedHypothesis =
			researchBundle.hypotheses.find((hypothesis) =>
				researchBundle.piPlan.selectedHypothesisIds.includes(hypothesis.id),
			) ?? researchBundle.hypotheses[0]

		const branchResult = await this.deps.runTool<
			{ action: 'ensure'; preferredKind: Hypothesis['branchKind']; hypothesis: Hypothesis },
			{ branch: BranchRecord }
		>(
			'worktree_manager',
			{
				action: 'ensure',
				preferredKind: researchBundle.piPlan.selectedBranchKind,
				hypothesis: selectedHypothesis,
			},
			roundId,
		)
		const branch = branchResult.branch

		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'PLANNING_PATCH',
		}))

		const plan = this.engineer.createPatchPlan({
			hypothesis: selectedHypothesis,
			repoSummary: researchBundle.scouted.repoSummary,
			keyFiles: researchBundle.scouted.keyFiles,
			configs: researchBundle.scouted.configs,
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

		return {
			branch,
			plan,
			executionTarget,
		}
	}

	private async applyPatchAndValidate(
		input: ResearchMissionInput,
		roundId: string,
		planBundle: RoundPlanBundle,
		scouted: RoundResearchBundle['scouted'],
	): Promise<RoundValidationBundle> {
		const patchResultInfo = await this.engineer.applyPatch({
			roundId,
			branch: planBundle.branch,
			patchPlan: planBundle.plan.patchPlan,
		})
		const patchResult: PatchResult = {
			id: patchResultInfo.patchResultId,
			patchPlanId: planBundle.plan.patchPlan.id,
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
			SmokeRunResult
		>(
			'smoke_run',
			{
				commands: validationCommands.length > 0 ? validationCommands : ['pwd'],
				executionTarget: planBundle.executionTarget,
			},
			roundId,
			planBundle.branch.id,
		)
		await this.runtime.artifactStore.writeJson(
			`validation_logs/${roundId}.json`,
			smoke as unknown as Record<string, unknown>,
		)

		return {
			patchResult,
			smoke,
			validationCommands,
		}
	}

	private async handleSmokeFailure(
		roundId: string,
		branch: BranchRecord,
		patchIntent: string,
		smoke: SmokeRunResult,
	): Promise<RoundExecutionOutcome> {
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
		const failuresAndFixes = [
			`Validation failed before full experiment. Classified as ${failure.failureClass}.`,
		]
		await this.runtime.memoryStore.noteLoopUpdate({
			failedDirection: patchIntent,
			failureClass: failure.failureClass,
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
				note: `Validation failure (${failure.failureClass}) in ${roundId}`,
			},
			roundId,
			branch.id,
		)
		return {
			runIds: [],
			metricHighlights: {},
			experimentsSummary: [],
			failuresAndFixes,
		}
	}

	private async runExperimentPhase(
		input: ResearchMissionInput,
		roundId: string,
		planBundle: RoundPlanBundle,
		researchBundle: RoundResearchBundle,
		validationCommands: string[],
	): Promise<RoundExecutionOutcome> {
		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'RUNNING_EXPERIMENT',
		}))

		const experimentPlan: ExperimentPlan = {
			id: createRunLabel(this.runtime.state.budgetUsage.experimentsUsed + 1),
			hypothesisId: planBundle.plan.patchPlan.hypothesisId,
			branchId: planBundle.branch.id,
			objective: researchBundle.piPlan.roundObjective,
			variants: [planBundle.plan.patchPlan.intent],
			controls: validationCommands.slice(0, 2),
			metrics: input.metrics ?? [],
			budget: input.budget,
			stoppingRules: [
				'Stop after smoke + short run if metrics regress or logs indicate instability.',
				'Only continue to full run after a successful short run.',
			],
			expectedOutcome:
				researchBundle.hypotheses[0]?.expectedGain ?? 'Reduce uncertainty or improve best-so-far.',
			executionTarget: planBundle.executionTarget,
		}
		await this.deps.runTool(
			'experiment_plan_writer',
			{ plan: experimentPlan },
			roundId,
			planBundle.branch.id,
		)

		const runnerOutput = await this.runner.run({
			roundId,
			branchId: planBundle.branch.id,
			experimentPlan,
			commandTemplate:
				input.fullRunCommand ?? input.shortRunCommand ?? validationCommands[0] ?? 'pwd',
		})
		const failuresAndFixes = runnerOutput.failureClasses.map(
			(currentFailure) => `Experiment issue classified as ${currentFailure}.`,
		)
		await this.runtime.updateState((state) => ({
			...state,
			budgetUsage: {
				...state.budgetUsage,
				experimentsUsed: state.budgetUsage.experimentsUsed + 1,
			},
		}))
		await this.runtime.artifactStore.writeJson(
			`runs/${roundId}/metrics.json`,
			runnerOutput.metricHighlights,
		)
		return {
			runIds: runnerOutput.runIds,
			metricHighlights: runnerOutput.metricHighlights,
			experimentsSummary: runnerOutput.summaries,
			failuresAndFixes,
		}
	}

	private async resolveRoundOutcome(
		input: ResearchMissionInput,
		roundId: string,
		planBundle: RoundPlanBundle,
		researchBundle: RoundResearchBundle,
		validationBundle: RoundValidationBundle,
	): Promise<RoundExecutionOutcome> {
		if (!validationBundle.smoke.success) {
			return this.handleSmokeFailure(
				roundId,
				planBundle.branch,
				planBundle.plan.patchPlan.intent,
				validationBundle.smoke,
			)
		}
		return this.runExperimentPhase(
			input,
			roundId,
			planBundle,
			researchBundle,
			validationBundle.validationCommands,
		)
	}

	private findRemoteMachine(
		remoteMachines: RemoteMachineConfig[],
		executionTarget: ExecutionTarget,
	): RemoteMachineConfig | undefined {
		if (executionTarget.type !== 'ssh') {
			return undefined
		}
		return remoteMachines.find((machine) => machine.id === executionTarget.machineId)
	}

	private buildBestSoFar(
		roundId: string,
		branch: BranchRecord,
		readerOutput: RoundResearchBundle['readerOutput'],
		metricHighlights: Record<string, number>,
		runIds: string[],
		experimentsSummary: string[],
	): BestSoFarArtifact {
		return {
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
	}

	private buildNextActions(
		branch: BranchRecord,
		piPlan: RoundResearchBundle['piPlan'],
	): NextAction[] {
		return [
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
		]
	}

	private async writeRoundReflectionArtifacts(
		input: ResearchMissionInput,
		roundId: string,
		planBundle: RoundPlanBundle,
		researchBundle: RoundResearchBundle,
		validationBundle: RoundValidationBundle,
		outcome: RoundExecutionOutcome,
		critic: ReturnType<CriticAgent['review']>,
		nextActions: NextAction[],
	): Promise<void> {
		await this.runtime.artifactStore.writeJson('results/reflection.json', {
			hypothesisId: researchBundle.hypotheses[0].id,
			roundId,
			outcome: critic.verdict,
			exploitOrExploreNext: researchBundle.piPlan.exploitOrExplore,
			substantialProgress:
				outcome.runIds.length > 0 || validationBundle.patchResult.filesChanged.length > 0,
			bestSoFarImproved: outcome.runIds.length > 0,
			nextCandidateHypothesisIds: researchBundle.hypotheses.map((hypothesis) => hypothesis.id),
			notes: critic.concerns,
		})
		await this.runtime.artifactStore.writeJson(
			'results/next_actions.json',
			nextActions as unknown as Record<string, unknown>,
		)
		await this.runtime.artifactStore.writeJson('results/updated_branch_plan.json', {
			activeBranchId: planBundle.branch.id,
			branchKind: planBundle.branch.kind,
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
	}

	private formatCodeChanges(patchResult: PatchResult): string[] {
		if (patchResult.filesChanged.length > 0) {
			return [patchResult.diffSummary]
		}
		return ['No deterministic patch landed; round stayed artifact-driven and branch-isolated.']
	}

	private formatExperimentSummaries(experimentsSummary: string[]): string[] {
		if (experimentsSummary.length > 0) {
			return experimentsSummary
		}
		return ['No full experiment launched because validation failed or resources were gated.']
	}

	private formatFailures(failuresAndFixes: string[]): string[] {
		if (failuresAndFixes.length > 0) {
			return failuresAndFixes
		}
		return ['No blocking failures in this round.']
	}

	private formatUncertainties(concerns: string[]): string[] {
		if (concerns.length > 0) {
			return concerns
		}
		return ['Metric confidence still needs additional runs.']
	}

	private buildExecutionEnvironmentSummary(
		executionTarget: ExecutionTarget,
		remoteMachine: RemoteMachineConfig | undefined,
	): string[] {
		const isRemote = executionTarget.type === 'ssh'
		return [
			`mode: ${isRemote ? 'remote' : 'local'}`,
			`remote host: ${remoteMachine?.host ?? (isRemote ? (executionTarget.machineId ?? 'n/a') : 'n/a')}`,
			`GPU allocation: ${executionTarget.gpuAllocation?.visibleDevices ?? executionTarget.gpuAllocation?.mode ?? 'none'}`,
			`environment name: ${remoteMachine?.pythonEnvName ?? (isRemote ? 'unspecified' : 'local/default')}`,
			`working directory: ${executionTarget.cwd}`,
		]
	}

	private buildRoundReport(
		roundId: string,
		planBundle: RoundPlanBundle,
		researchBundle: RoundResearchBundle,
		bestSoFar: BestSoFarArtifact,
		nextActions: NextAction[],
		outcome: RoundExecutionOutcome,
		critic: ReturnType<CriticAgent['review']>,
		remoteMachines: RemoteMachineConfig[],
		validationBundle: RoundValidationBundle,
	): UserRoundReport {
		const remoteMachine = this.findRemoteMachine(remoteMachines, planBundle.executionTarget)
		return {
			roundId,
			objective: researchBundle.piPlan.roundObjective,
			researchSummary: [
				...researchBundle.scouted.repoSummary,
				...researchBundle.scouted.sourceSummaries.slice(0, 3),
			],
			evidenceAdded: researchBundle.readerOutput.extractedClaims.slice(0, 5),
			codeChanges: this.formatCodeChanges(validationBundle.patchResult),
			experimentsRun: this.formatExperimentSummaries(outcome.experimentsSummary),
			keyResults: [
				...Object.entries(outcome.metricHighlights).map(([metric, value]) => `${metric}=${value}`),
				`Critic verdict: ${critic.verdict}`,
			],
			failuresAndFixes: this.formatFailures(outcome.failuresAndFixes),
			currentBestSoFar: bestSoFar.summary,
			uncertainties: this.formatUncertainties(critic.concerns),
			nextRoundPlan: nextActions.map((action) => action.description),
			executionEnvironmentSummary: this.buildExecutionEnvironmentSummary(
				planBundle.executionTarget,
				remoteMachine,
			),
		}
	}

	private async persistRoundIndexAndTask(
		input: ResearchMissionInput,
		roundId: string,
		roundNumber: number,
		task: ResearchTask,
		nextActions: NextAction[],
		reportPath: string,
		bestSoFarSummary: string,
	): Promise<void> {
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
			latestReportPath: reportPath,
			bestSoFarSummary,
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
				reportPath,
				bestSoFar: bestSoFarSummary,
			},
		})
		await this.trace.log({
			type: 'round_completed',
			roundId,
			data: {
				reportPath,
			},
		})
	}

	private computeReadyForSummarization(
		input: ResearchMissionInput,
		roundNumber: number,
		outcome: RoundExecutionOutcome,
	): boolean {
		if (outcome.runIds.length > 0 && (input.successCriteria?.length ?? 0) === 0) {
			return roundNumber >= 2
		}
		return Object.keys(outcome.metricHighlights).length > 0
	}

	private async completeRound(
		input: ResearchMissionInput,
		roundId: string,
		roundNumber: number,
		task: ResearchTask,
		remoteMachines: RemoteMachineConfig[],
		planBundle: RoundPlanBundle,
		researchBundle: RoundResearchBundle,
		validationBundle: RoundValidationBundle,
		outcome: RoundExecutionOutcome,
	): Promise<{ reportContent: string; readyForSummarization: boolean }> {
		await this.runtime.updateState((state) => ({
			...state,
			researchState: 'REFLECTING',
			topLevelState: 'REPORTING',
		}))

		const critic = this.critic.review({
			hypothesis: researchBundle.hypotheses[0],
			runIds: outcome.runIds,
			patchResult: validationBundle.patchResult,
			metricHighlights: outcome.metricHighlights,
		})
		const bestSoFar = this.buildBestSoFar(
			roundId,
			planBundle.branch,
			researchBundle.readerOutput,
			outcome.metricHighlights,
			outcome.runIds,
			outcome.experimentsSummary,
		)
		const nextActions = this.buildNextActions(planBundle.branch, researchBundle.piPlan)

		await this.writeRoundReflectionArtifacts(
			input,
			roundId,
			planBundle,
			researchBundle,
			validationBundle,
			outcome,
			critic,
			nextActions,
		)

		const report = this.buildRoundReport(
			roundId,
			planBundle,
			researchBundle,
			bestSoFar,
			nextActions,
			outcome,
			critic,
			remoteMachines,
			validationBundle,
		)
		const reportResult = await this.reporting.writeRoundReport(roundId, report, bestSoFar)
		await this.persistRoundIndexAndTask(
			input,
			roundId,
			roundNumber,
			task,
			nextActions,
			reportResult.reportPath,
			bestSoFar.summary,
		)

		const readyForSummarization = this.computeReadyForSummarization(input, roundNumber, outcome)
		await this.runtime.updateState((state) => ({
			...state,
			topLevelState: readyForSummarization ? 'READY_FOR_SUMMARIZATION' : 'RESEARCH_LOOP',
			researchState: 'RESEARCH_ROUND_DONE',
		}))

		return {
			reportContent: reportResult.content,
			readyForSummarization,
		}
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
		const task = await this.startRound(roundNumber, roundId)
		const researchBundle = await this.collectResearchBundle(input, roundId)
		const planBundle = await this.prepareRoundPlan(input, roundId, remoteMachines, researchBundle)
		const validationBundle = await this.applyPatchAndValidate(
			input,
			roundId,
			planBundle,
			researchBundle.scouted,
		)
		const outcome = await this.resolveRoundOutcome(
			input,
			roundId,
			planBundle,
			researchBundle,
			validationBundle,
		)
		const completion = await this.completeRound(
			input,
			roundId,
			roundNumber,
			task,
			remoteMachines,
			planBundle,
			researchBundle,
			validationBundle,
			outcome,
		)
		return {
			reportContent: completion.reportContent,
			progressMade:
				outcome.runIds.length > 0 || validationBundle.patchResult.filesChanged.length > 0,
			readyForSummarization: completion.readyForSummarization,
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
