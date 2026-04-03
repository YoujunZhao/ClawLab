import { z } from 'zod/v4'

export const ResearchPermissionModeSchema = z.enum(['default', 'plan', 'auto', 'bypassPermissions'])

export const ResearchRuntimeModeSchema = z.enum(['PLAN_MODE', 'EXECUTION_MODE', 'SUMMARIZE_MODE'])

export const ResearchModelProviderSchema = z.enum([
	'auto',
	'stub',
	'anthropic_oauth',
	'anthropic_api_key',
	'openai_compatible',
])

export const MissionModeSchema = z.enum(['new_project', 'existing_project_improvement'])

export const TopLevelStateSchema = z.enum([
	'IDLE',
	'MISSION_FRAMING',
	'RESEARCH_LOOP',
	'REPORTING',
	'WAITING_FOR_RESOURCES',
	'PAUSED',
	'READY_FOR_SUMMARIZATION',
	'FINAL_SUMMARIZATION',
	'ARCHIVED',
])

export const ResearchStateSchema = z.enum([
	'RESEARCHING',
	'FORMING_HYPOTHESES',
	'BRANCH_SELECTION',
	'PLANNING_PATCH',
	'PATCHING',
	'VALIDATING',
	'RUNNING_EXPERIMENT',
	'DEBUGGING',
	'REFLECTING',
	'RESEARCH_ROUND_DONE',
])

export const FinalSummarizationStateSchema = z.enum([
	'SUMMARY_PLANNING',
	'ARTIFACT_AGGREGATION',
	'NARRATIVE_SYNTHESIS',
	'FINAL_REPORT_DRAFTING',
	'FINAL_OUTPUT_READY',
])

export const ResearchBranchKindSchema = z.enum(['mainline', 'exploration', 'repair'])

export const BranchStatusSchema = z.enum(['active', 'idle', 'failed', 'archived'])

export const HypothesisStatusSchema = z.enum([
	'candidate',
	'selected',
	'running',
	'validated',
	'failed',
	'archived',
])

export const FailureClassSchema = z.enum([
	'syntax_import',
	'dependency_config',
	'data_issue',
	'oom_resource',
	'metric_bug',
	'instability',
	'regression',
	'inconclusive',
])

export const RunStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled'])

export const ResearchTaskStatusSchema = z.enum([
	'pending',
	'running',
	'completed',
	'failed',
	'blocked',
	'cancelled',
])

export const SuccessCriterionSchema = z.strictObject({
	name: z.string(),
	description: z.string().optional(),
	direction: z.enum(['maximize', 'minimize', 'match']).default('maximize'),
	target: z.number().optional(),
	tolerance: z.number().optional(),
})

export const BudgetSchema = z.strictObject({
	tokenBudget: z.number().int().nonnegative().optional(),
	searchBudget: z.number().int().nonnegative().optional(),
	patchBudget: z.number().int().nonnegative().optional(),
	experimentBudget: z.number().int().nonnegative().optional(),
	debugBudget: z.number().int().nonnegative().optional(),
	wallClockMinutes: z.number().nonnegative().optional(),
	gpuCount: z.number().int().nonnegative().optional(),
	gpuHours: z.number().nonnegative().optional(),
	maxRounds: z.number().int().positive().optional(),
})

export const BudgetUsageSchema = z.strictObject({
	roundsCompleted: z.number().int().nonnegative().default(0),
	searchesUsed: z.number().int().nonnegative().default(0),
	patchesUsed: z.number().int().nonnegative().default(0),
	experimentsUsed: z.number().int().nonnegative().default(0),
	debugActionsUsed: z.number().int().nonnegative().default(0),
	startedAt: z.string(),
	lastUpdatedAt: z.string(),
})

export const MetricSnapshotSchema = z.record(z.string(), z.number()).default({})

export const TaskModelOverridesSchema = z
	.strictObject({
		research: z.string().optional(),
		code: z.string().optional(),
		report: z.string().optional(),
		summary: z.string().optional(),
	})
	.default({})

export const ResearchModelConnectionSchema = z.strictObject({
	provider: ResearchModelProviderSchema.default('auto'),
	displayName: z.string().optional(),
	model: z.string().optional(),
	taskModels: TaskModelOverridesSchema,
	baseUrl: z.string().optional(),
	apiKeyEnvVar: z.string().optional(),
})

export const MissionArtifactSchema = z.strictObject({
	id: z.string(),
	missionType: MissionModeSchema.default('new_project'),
	topic: z.string(),
	title: z.string(),
	objective: z.string(),
	problemStatement: z.string().optional(),
	baselineSummary: z.string().optional(),
	improvementGoal: z.string().optional(),
	targetMetric: z.string().optional(),
	currentMetricsSnapshot: MetricSnapshotSchema,
	preferredFocusFiles: z.array(z.string()).default([]),
	constraints: z.array(z.string()).default([]),
	repoPath: z.string().optional(),
	repoUrl: z.string().optional(),
	computeBudget: BudgetSchema.optional(),
	metrics: z.array(z.string()).default([]),
	successCriteria: z.array(SuccessCriterionSchema).default([]),
	modelConnection: ResearchModelConnectionSchema.optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
})

export const SourceRecordSchema = z.strictObject({
	id: z.string(),
	url: z.string(),
	title: z.string(),
	snippet: z.string().optional(),
	sourceType: z.enum(['web', 'paper', 'repo', 'pdf']),
	authors: z.array(z.string()).optional(),
	publishedAt: z.string().optional(),
	fetchedAt: z.string(),
})

export const RepoCandidateSchema = z.strictObject({
	id: z.string(),
	name: z.string(),
	path: z.string().optional(),
	url: z.string().optional(),
	notes: z.string().optional(),
	score: z.number().default(0),
})

export const EvidenceCardSchema = z.strictObject({
	id: z.string(),
	source: z.string(),
	title: z.string(),
	claim: z.string(),
	evidenceText: z.string(),
	evidenceType: z.string(),
	limitations: z.array(z.string()).default([]),
	relevance: z.number().min(0).max(1),
	confidence: z.number().min(0).max(1),
	tags: z.array(z.string()).default([]),
	createdByAgent: z.string(),
})

export const HypothesisSchema = z.strictObject({
	id: z.string(),
	description: z.string(),
	whyNow: z.string(),
	evidenceLinks: z.array(z.string()).default([]),
	expectedGain: z.string(),
	risk: z.string(),
	minimalTest: z.string(),
	confidence: z.number().min(0).max(1),
	branchKind: ResearchBranchKindSchema,
	status: HypothesisStatusSchema,
})

export const BranchRecordSchema = z.strictObject({
	id: z.string(),
	name: z.string(),
	kind: ResearchBranchKindSchema,
	hypothesisIds: z.array(z.string()).default([]),
	worktreePath: z.string(),
	status: BranchStatusSchema,
	notes: z.array(z.string()).default([]),
})

export const PatchPlanSchema = z.strictObject({
	id: z.string(),
	hypothesisId: z.string(),
	intent: z.string(),
	filesToChange: z.array(z.string()).default([]),
	riskLevel: z.enum(['low', 'medium', 'high']),
	validationSteps: z.array(z.string()).default([]),
	rollbackPlan: z.string(),
	notes: z.array(z.string()).default([]),
})

export const PatchResultSchema = z.strictObject({
	id: z.string(),
	patchPlanId: z.string(),
	filesChanged: z.array(z.string()).default([]),
	diffSummary: z.string(),
	commitHash: z.string().optional(),
	success: z.boolean(),
	failureReason: z.string().optional(),
})

export const GPUAllocationSchema = z.strictObject({
	mode: z.enum(['auto', 'manual']),
	visibleDevices: z.string().optional(),
	requiredGpuCount: z.number().int().positive().optional(),
	requiredMinMemoryGb: z.number().positive().optional(),
})

export const RemoteMachineConfigSchema = z.strictObject({
	id: z.string(),
	host: z.string(),
	port: z.number().int().positive().optional(),
	username: z.string(),
	authType: z.enum(['ssh_key', 'password']),
	sshKeyPath: z.string().optional(),
	password: z.string().optional(),
	remoteWorkspace: z.string(),
	pythonEnvType: z.enum(['conda', 'venv', 'system']).optional(),
	pythonEnvName: z.string().optional(),
	defaultShell: z.string().optional(),
})

export const ExecutionTargetSchema = z.strictObject({
	type: z.enum(['local', 'ssh']),
	machineId: z.string().optional(),
	cwd: z.string(),
	gpuAllocation: GPUAllocationSchema.optional(),
})

export const ExperimentPlanSchema = z.strictObject({
	id: z.string(),
	hypothesisId: z.string(),
	branchId: z.string(),
	objective: z.string(),
	variants: z.array(z.string()).default([]),
	controls: z.array(z.string()).default([]),
	metrics: z.array(z.string()).default([]),
	budget: BudgetSchema.optional(),
	stoppingRules: z.array(z.string()).default([]),
	expectedOutcome: z.string(),
	executionTarget: ExecutionTargetSchema,
})

export const ExperimentRunSchema = z.strictObject({
	id: z.string(),
	experimentPlanId: z.string(),
	executionTarget: ExecutionTargetSchema,
	startedAt: z.string(),
	endedAt: z.string().optional(),
	command: z.string(),
	status: RunStatusSchema,
	logPath: z.string().optional(),
	artifactPaths: z.array(z.string()).default([]),
	metrics: z.record(z.string(), z.number()).default({}),
	failureClass: FailureClassSchema.optional(),
	summary: z.string(),
})

export const ExperimentComparisonSchema = z.strictObject({
	baselineRunId: z.string(),
	candidateRunId: z.string(),
	metricDeltas: z.record(z.string(), z.number()).default({}),
	verdict: z.string(),
	explanation: z.string(),
})

export const ValidationPlanSchema = z.strictObject({
	staticCheckCommands: z.array(z.string()).default([]),
	lintCommands: z.array(z.string()).default([]),
	unitTestCommands: z.array(z.string()).default([]),
	dryRunCommands: z.array(z.string()).default([]),
	smokeRunCommands: z.array(z.string()).default([]),
})

export const SmokeResultSchema = z.strictObject({
	success: z.boolean(),
	checks: z.array(
		z.strictObject({
			name: z.string(),
			command: z.string(),
			success: z.boolean(),
			stdout: z.string().optional(),
			stderr: z.string().optional(),
			logPath: z.string().optional(),
		}),
	),
})

export const ReflectionArtifactSchema = z.strictObject({
	hypothesisId: z.string(),
	roundId: z.string(),
	outcome: z.string(),
	exploitOrExploreNext: z.enum(['exploit', 'explore', 'repair']),
	substantialProgress: z.boolean(),
	bestSoFarImproved: z.boolean(),
	nextCandidateHypothesisIds: z.array(z.string()).default([]),
	notes: z.array(z.string()).default([]),
})

export const BestSoFarArtifactSchema = z.strictObject({
	roundId: z.string(),
	summary: z.string(),
	branchId: z.string().optional(),
	runId: z.string().optional(),
	supportingEvidenceIds: z.array(z.string()).default([]),
	metrics: z.record(z.string(), z.number()).default({}),
	updatedAt: z.string(),
})

export const NextActionSchema = z.strictObject({
	id: z.string(),
	kind: z.enum(['exploit', 'explore', 'repair', 'summarize', 'wait']),
	title: z.string(),
	description: z.string(),
	branchId: z.string().optional(),
	hypothesisIds: z.array(z.string()).default([]),
})

export const UserRoundReportSchema = z.strictObject({
	roundId: z.string(),
	objective: z.string(),
	researchSummary: z.array(z.string()).default([]),
	evidenceAdded: z.array(z.string()).default([]),
	codeChanges: z.array(z.string()).default([]),
	experimentsRun: z.array(z.string()).default([]),
	keyResults: z.array(z.string()).default([]),
	failuresAndFixes: z.array(z.string()).default([]),
	currentBestSoFar: z.string(),
	uncertainties: z.array(z.string()).default([]),
	nextRoundPlan: z.array(z.string()).default([]),
	executionEnvironmentSummary: z.array(z.string()).default([]),
})

export const FinalSummaryArtifactSchema = z.strictObject({
	id: z.string(),
	type: z.enum(['summary', 'report', 'paper_draft', 'rebuttal_notes', 'appendix_notes']),
	title: z.string(),
	scope: z.string(),
	includedRoundIds: z.array(z.string()).default([]),
	includedRunIds: z.array(z.string()).default([]),
	includedEvidenceIds: z.array(z.string()).default([]),
	content: z.string(),
	version: z.number().int().positive(),
})

export const ResearchIndexArtifactSchema = z.strictObject({
	sessionId: z.string(),
	missionId: z.string(),
	missionType: MissionModeSchema,
	topic: z.string(),
	problemStatement: z.string().optional(),
	targetMetric: z.string().optional(),
	currentRound: z.number().int().nonnegative(),
	topLevelState: TopLevelStateSchema,
	researchState: ResearchStateSchema.optional(),
	latestRoundId: z.string().optional(),
	latestReportPath: z.string().optional(),
	bestSoFarSummary: z.string().optional(),
	activeBranches: z.array(
		z.strictObject({
			id: z.string(),
			name: z.string(),
			kind: ResearchBranchKindSchema,
			status: BranchStatusSchema,
		}),
	),
	nextActions: z.array(
		z.strictObject({
			id: z.string(),
			kind: z.enum(['exploit', 'explore', 'repair', 'summarize', 'wait']),
			title: z.string(),
			branchId: z.string().optional(),
		}),
	),
	updatedAt: z.string(),
})

export const ResearchTaskSchema = z.strictObject({
	id: z.string(),
	parentTaskId: z.string().optional(),
	type: z.string(),
	title: z.string(),
	objective: z.string(),
	status: ResearchTaskStatusSchema,
	phase: z.string(),
	assignedAgent: z.string().optional(),
	branchId: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	budget: BudgetSchema.optional(),
	inputs: z.record(z.string(), z.unknown()).default({}),
	outputs: z.record(z.string(), z.unknown()).default({}),
	artifactIds: z.array(z.string()).default([]),
	nextActionIds: z.array(z.string()).default([]),
})

export const ResearchSessionStateSchema = z.strictObject({
	sessionId: z.string(),
	missionId: z.string(),
	topic: z.string(),
	repoPath: z.string(),
	topLevelState: TopLevelStateSchema,
	researchState: ResearchStateSchema.optional(),
	finalSummarizationState: FinalSummarizationStateSchema.optional(),
	runtimeMode: ResearchRuntimeModeSchema,
	permissionMode: ResearchPermissionModeSchema,
	currentRound: z.number().int().nonnegative(),
	activeBranchId: z.string().optional(),
	latestBestSoFarPath: z.string().optional(),
	readyForSummarization: z.boolean().default(false),
	userApprovedSummarization: z.boolean().default(false),
	paused: z.boolean().default(false),
	stopRequested: z.boolean().default(false),
	waitingForResources: z.boolean().default(false),
	remoteMachines: z.array(RemoteMachineConfigSchema).default([]),
	modelConnection: ResearchModelConnectionSchema.optional(),
	budget: BudgetSchema.optional(),
	budgetUsage: BudgetUsageSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
	notes: z.array(z.string()).default([]),
})

export type ResearchPermissionMode = z.infer<typeof ResearchPermissionModeSchema>
export type ResearchRuntimeMode = z.infer<typeof ResearchRuntimeModeSchema>
export type ResearchModelProvider = z.infer<typeof ResearchModelProviderSchema>
export type MissionMode = z.infer<typeof MissionModeSchema>
export type TopLevelState = z.infer<typeof TopLevelStateSchema>
export type ResearchState = z.infer<typeof ResearchStateSchema>
export type FinalSummarizationState = z.infer<typeof FinalSummarizationStateSchema>
export type ResearchBranchKind = z.infer<typeof ResearchBranchKindSchema>
export type MissionArtifact = z.infer<typeof MissionArtifactSchema>
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>
export type Budget = z.infer<typeof BudgetSchema>
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>
export type TaskModelOverrides = z.infer<typeof TaskModelOverridesSchema>
export type ResearchModelConnection = z.infer<typeof ResearchModelConnectionSchema>
export type SourceRecord = z.infer<typeof SourceRecordSchema>
export type RepoCandidate = z.infer<typeof RepoCandidateSchema>
export type EvidenceCard = z.infer<typeof EvidenceCardSchema>
export type Hypothesis = z.infer<typeof HypothesisSchema>
export type BranchRecord = z.infer<typeof BranchRecordSchema>
export type PatchPlan = z.infer<typeof PatchPlanSchema>
export type PatchResult = z.infer<typeof PatchResultSchema>
export type GPUAllocation = z.infer<typeof GPUAllocationSchema>
export type RemoteMachineConfig = z.infer<typeof RemoteMachineConfigSchema>
export type ExecutionTarget = z.infer<typeof ExecutionTargetSchema>
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>
export type ExperimentRun = z.infer<typeof ExperimentRunSchema>
export type ExperimentComparison = z.infer<typeof ExperimentComparisonSchema>
export type ValidationPlan = z.infer<typeof ValidationPlanSchema>
export type SmokeResult = z.infer<typeof SmokeResultSchema>
export type ReflectionArtifact = z.infer<typeof ReflectionArtifactSchema>
export type BestSoFarArtifact = z.infer<typeof BestSoFarArtifactSchema>
export type NextAction = z.infer<typeof NextActionSchema>
export type UserRoundReport = z.infer<typeof UserRoundReportSchema>
export type FinalSummaryArtifact = z.infer<typeof FinalSummaryArtifactSchema>
export type ResearchIndexArtifact = z.infer<typeof ResearchIndexArtifactSchema>
export type ResearchTask = z.infer<typeof ResearchTaskSchema>
export type ResearchTaskStatus = z.infer<typeof ResearchTaskStatusSchema>
export type ResearchSessionState = z.infer<typeof ResearchSessionStateSchema>
