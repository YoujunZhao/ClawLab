import { createResearchId } from '../core/ids.js'
import type { ModelResponse, ModelTask } from '../core/model-router/modelRouter.js'
import type {
	BestSoFarArtifact,
	BranchRecord,
	EvidenceCard,
	ExperimentPlan,
	Hypothesis,
	PatchPlan,
	PatchResult,
	ResearchBranchKind,
} from '../core/schemas.js'

export type ToolRunner = <Input, Output>(
	name: string,
	input: Input,
	roundId: string,
	branchId?: string,
) => Promise<Output>

type AgentDeps = {
	runTool: ToolRunner
	runModel?: (task: ModelTask, prompt: string) => Promise<ModelResponse>
}

export class PIAgent {
	constructor(private readonly deps: AgentDeps) {}

	async planRound(input: {
		roundId: string
		missionTopic: string
		currentBestSummary?: string
		recentFailures: string[]
		openQuestions: string[]
		hypotheses: Hypothesis[]
	}): Promise<{
		roundObjective: string
		selectedBranchKind: ResearchBranchKind
		selectedHypothesisIds: string[]
		exploitOrExplore: 'exploit' | 'explore' | 'repair'
		rationale: string
	}> {
		const sorted = [...input.hypotheses].sort((left, right) => right.confidence - left.confidence)
		const selected = sorted.slice(0, Math.min(2, sorted.length))
		const exploitOrExplore =
			input.recentFailures.length >= 2 ? 'repair' : input.currentBestSummary ? 'exploit' : 'explore'
		const selectedBranchKind =
			exploitOrExplore === 'repair'
				? 'repair'
				: exploitOrExplore === 'exploit'
					? 'mainline'
					: 'exploration'
		const fallbackRationale =
			exploitOrExplore === 'repair'
				? 'Recent failures cluster around execution stability, so the repair branch gets priority.'
				: exploitOrExplore === 'exploit'
					? 'There is a credible best-so-far signal, so the next round should exploit the strongest hypothesis.'
					: 'There is no dominant best-so-far yet, so the next round should explore the strongest unexplored path.'
		let rationale = fallbackRationale
		if (this.deps.runModel) {
			try {
				const response = await this.deps.runModel(
					'research',
					[
						'Write one concise rationale for the next ClawLab round.',
						`Mission topic: ${input.missionTopic}`,
						`Current best summary: ${input.currentBestSummary ?? 'none'}`,
						`Recent failures: ${input.recentFailures.join(' | ') || 'none'}`,
						`Open questions: ${input.openQuestions.join(' | ') || 'none'}`,
						`Selected hypothesis IDs: ${selected.map((hypothesis) => hypothesis.id).join(', ') || 'none'}`,
						`Chosen branch kind: ${selectedBranchKind}`,
						`Mode: ${exploitOrExplore}`,
					].join('\n'),
				)
				if (response.content.trim()) {
					rationale = response.content.trim()
				}
			} catch {
				rationale = fallbackRationale
			}
		}
		return {
			roundObjective: selected[0]?.minimalTest ?? `Reduce uncertainty around ${input.missionTopic}`,
			selectedBranchKind,
			selectedHypothesisIds: selected.map((hypothesis) => hypothesis.id),
			exploitOrExplore,
			rationale,
		}
	}
}

export class ScoutAgent {
	constructor(private readonly deps: AgentDeps) {}

	async scout(input: {
		roundId: string
		topic: string
		keywords: string[]
		repoContext: string
		targetQuestions: string[]
	}): Promise<{
		sourceRefs: Array<{ id: string; title: string; url: string }>
		sourceSummaries: string[]
		candidateBaselines: string[]
		candidateBenchmarks: string[]
		repoSummary: string[]
		keyFiles: string[]
		commands: string[]
		configs: string[]
	}> {
		const web = await this.deps.runTool<
			{ query: string; limit?: number },
			{ results: Array<{ id: string; title: string; url: string; snippet?: string }> }
		>(
			'web_search',
			{
				query: [input.topic, ...input.keywords].join(' '),
				limit: 5,
			},
			input.roundId,
		)
		const papers = await this.deps.runTool<
			{ query: string; limit?: number },
			{ results: Array<{ id: string; title: string; url: string; snippet?: string }> }
		>(
			'paper_search',
			{
				query: input.topic,
				limit: 5,
			},
			input.roundId,
		)
		const repoMap = await this.deps.runTool<
			{ root?: string },
			{ summary: string[]; keyFiles: string[]; commands: string[]; configs: string[] }
		>('repo_map', {}, input.roundId)

		const sourceRefs = [...web.results, ...papers.results].map((result) => ({
			id: result.id,
			title: result.title,
			url: result.url,
		}))
		const sourceSummaries = [...web.results, ...papers.results]
			.map((result) => `${result.title}: ${result.snippet ?? 'No snippet available'}`)
			.slice(0, 10)
		const candidateBaselines = sourceRefs
			.map((source) => source.title)
			.filter((title) => /baseline|benchmark|sota|model|method/iu.test(title))
			.slice(0, 5)
		const candidateBenchmarks = input.targetQuestions
			.filter((question) => /benchmark|metric|eval/iu.test(question))
			.concat(repoMap.keyFiles.filter((file) => /eval|bench|test/iu.test(file)))
			.slice(0, 5)
		return {
			sourceRefs,
			sourceSummaries,
			candidateBaselines,
			candidateBenchmarks,
			repoSummary: repoMap.summary,
			keyFiles: repoMap.keyFiles,
			commands: repoMap.commands,
			configs: repoMap.configs,
		}
	}
}

export class ReaderAgent {
	constructor(private readonly deps: AgentDeps) {}

	async read(input: {
		roundId: string
		targetQuestion: string
		sources: Array<{ id: string; title: string; url: string; snippet?: string }>
	}): Promise<{
		evidenceCardIds: string[]
		extractedClaims: string[]
		limitations: string[]
		engineeringHints: string[]
	}> {
		const cards: EvidenceCard[] = input.sources.slice(0, 6).map((source) => ({
			id: createResearchId('evidence'),
			source: source.id,
			title: source.title,
			claim: source.snippet ?? source.title,
			evidenceText: source.snippet ?? source.title,
			evidenceType: 'summary',
			limitations: [
				'Requires follow-up verification against the actual implementation or experiment logs',
			],
			relevance: 0.7,
			confidence: 0.55,
			tags: ['scouted', 'round-evidence'],
			createdByAgent: 'ReaderAgent',
		}))
		if (this.deps.runModel && cards.length > 0) {
			try {
				const response = await this.deps.runModel(
					'research',
					[
						'Summarize the strongest evidence cards for an automated research loop.',
						`Target question: ${input.targetQuestion}`,
						...cards.map((card) => `- ${card.title}: ${card.claim}`),
					].join('\n'),
				)
				if (response.content.trim()) {
					cards[0] = {
						...cards[0],
						claim: response.content.trim(),
						evidenceText: response.content.trim(),
						confidence: 0.7,
					}
				}
			} catch {
				// Keep deterministic fallback behavior if model routing is unavailable.
			}
		}
		await this.deps.runTool<{ cards: EvidenceCard[] }, { count: number }>(
			'evidence_writer',
			{ cards },
			input.roundId,
		)
		return {
			evidenceCardIds: cards.map((card) => card.id),
			extractedClaims: cards.map((card) => card.claim),
			limitations: cards.flatMap((card) => card.limitations),
			engineeringHints: cards.map(
				(card) => `Translate "${card.title}" into a minimal reproducible test before a full run`,
			),
		}
	}
}

export class EngineerAgent {
	constructor(private readonly deps: AgentDeps) {}

	createPatchPlan(input: {
		hypothesis: Hypothesis
		repoSummary: string[]
		keyFiles: string[]
		configs: string[]
		focusFiles?: string[]
	}): {
		patchPlan: PatchPlan
		validationChecklist: string[]
		targetFiles: string[]
	} {
		const prioritizedFocusFiles = (input.focusFiles ?? []).filter((file) =>
			input.keyFiles.includes(file),
		)
		const inferredFiles = input.keyFiles.filter((file) =>
			/config|eval|train|src|app|main|index/iu.test(file),
		)
		const targetFiles = Array.from(new Set([...prioritizedFocusFiles, ...inferredFiles])).slice(
			0,
			4,
		)
		const validationChecklist = ['static_check', 'lint', 'unit_test', 'dry_run', 'smoke_run']
		return {
			patchPlan: {
				id: createResearchId('patchplan'),
				hypothesisId: input.hypothesis.id,
				intent: input.hypothesis.description,
				filesToChange: targetFiles,
				riskLevel: input.hypothesis.branchKind === 'repair' ? 'low' : 'medium',
				validationSteps: validationChecklist,
				rollbackPlan:
					'Revert the isolated branch worktree or discard the branch if smoke tests regress.',
				notes: [
					...input.repoSummary.slice(0, 2),
					...(prioritizedFocusFiles.length > 0
						? [`User-prioritized focus files: ${prioritizedFocusFiles.join(', ')}`]
						: []),
					`Prioritize instrumentation or config-level edits that validate: ${input.hypothesis.minimalTest}`,
				],
			},
			validationChecklist,
			targetFiles,
		}
	}

	async applyPatch(input: {
		roundId: string
		branch: BranchRecord
		patchPlan: PatchPlan
	}): Promise<{
		patchResultId: string
		filesChanged: string[]
		diffSummary: string
		validationChecklist: string[]
	}> {
		const filesChanged: string[] = []
		for (const relativeFile of input.patchPlan.filesToChange.slice(0, 2)) {
			const filePath = input.branch.worktreePath.includes(relativeFile)
				? relativeFile
				: `${input.branch.worktreePath}/${relativeFile}`.replace(/\\/gu, '/')
			try {
				await this.deps.runTool(
					'patch_apply',
					{
						filePath,
						mode: 'append',
						content:
							'\n// Auto Research Loop note: instrumentation hook placeholder for hypothesis validation.\n',
					},
					input.roundId,
					input.branch.id,
				)
				filesChanged.push(relativeFile)
			} catch {
				// Keep the patch pipeline moving even when a chosen file is unsuitable.
			}
		}
		return {
			patchResultId: createResearchId('patchresult'),
			filesChanged,
			diffSummary:
				filesChanged.length > 0
					? `Applied instrumentation/config placeholder edits to ${filesChanged.join(', ')}`
					: 'No deterministic patch was synthesized this round; branch remains code-stable for recon-only work.',
			validationChecklist: input.patchPlan.validationSteps,
		}
	}
}

export class RunnerAgent {
	constructor(private readonly deps: AgentDeps) {}

	async run(input: {
		roundId: string
		branchId: string
		experimentPlan: ExperimentPlan
		commandTemplate: string
	}): Promise<{
		runIds: string[]
		summaries: string[]
		metricHighlights: Record<string, number>
		failureClasses: string[]
		smokeSuccess: boolean
		jobLogPath?: string
	}> {
		const smoke = await this.deps.runTool<
			{ commands: string[]; executionTarget: ExperimentPlan['executionTarget'] },
			{
				success: boolean
				checks: Array<{ command: string; success: boolean; stdout?: string; stderr?: string }>
			}
		>(
			'smoke_run',
			{
				commands:
					input.experimentPlan.controls.length > 0 ? input.experimentPlan.controls : ['pwd'],
				executionTarget: input.experimentPlan.executionTarget,
			},
			input.roundId,
			input.branchId,
		)
		if (!smoke.success) {
			const combined = smoke.checks
				.map((check) => `${check.command}\n${check.stderr ?? ''}`)
				.join('\n')
			const failure = await this.deps.runTool<{ text: string }, { failureClass: string }>(
				'failure_classifier',
				{ text: combined },
				input.roundId,
				input.branchId,
			)
			return {
				runIds: [],
				summaries: ['Smoke run failed before short/full execution'],
				metricHighlights: {},
				failureClasses: [failure.failureClass],
				smokeSuccess: false,
			}
		}

		const shortRun = await this.deps.runTool<
			{
				command: string
				executionTarget: ExperimentPlan['executionTarget']
				background?: boolean
			},
			{
				runId: string
				status: string
				stdout?: string
				stderr?: string
				logPath?: string
			}
		>(
			'job_launch',
			{
				command: input.commandTemplate,
				executionTarget: input.experimentPlan.executionTarget,
				background: false,
			},
			input.roundId,
			input.branchId,
		)
		if (shortRun.status !== 'done') {
			const failure = await this.deps.runTool<{ text: string }, { failureClass: string }>(
				'failure_classifier',
				{
					text: `${shortRun.stdout ?? ''}\n${shortRun.stderr ?? ''}`,
				},
				input.roundId,
				input.branchId,
			)
			return {
				runIds: [shortRun.runId],
				summaries: [`Short run ${shortRun.runId} failed before full execution`],
				metricHighlights: {},
				failureClasses: [failure.failureClass],
				smokeSuccess: true,
			}
		}
		const metrics = await this.deps.runTool<{ text: string }, { metrics: Record<string, number> }>(
			'metric_parser',
			{
				text: `${shortRun.stdout ?? ''}\n${shortRun.stderr ?? ''}`,
			},
			input.roundId,
			input.branchId,
		)
		const launched = await this.deps.runTool<
			{
				command: string
				executionTarget: ExperimentPlan['executionTarget']
				background?: boolean
			},
			{
				runId: string
				status: string
				stdout?: string
				stderr?: string
				logPath?: string
			}
		>(
			'job_launch',
			{
				command: input.commandTemplate,
				executionTarget: input.experimentPlan.executionTarget,
				background: true,
			},
			input.roundId,
			input.branchId,
		)
		return {
			runIds: [shortRun.runId, launched.runId],
			summaries: [
				`Short run ${shortRun.runId} succeeded`,
				`Full run ${launched.runId} launched with status ${launched.status}`,
			],
			metricHighlights: metrics.metrics,
			failureClasses: [],
			smokeSuccess: true,
			jobLogPath: launched.logPath,
		}
	}
}

export class CriticAgent {
	review(input: {
		hypothesis: Hypothesis
		runIds: string[]
		patchResult: PatchResult
		metricHighlights: Record<string, number>
	}): {
		verdict: string
		concerns: string[]
		suspiciousMetrics: string[]
		recommendedFixes: string[]
	} {
		const suspiciousMetrics = Object.entries(input.metricHighlights)
			.filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 1000)
			.map(([metric]) => metric)
		const concerns = [
			...(input.runIds.length === 0
				? ['No successful run ID was produced, so claims must remain provisional']
				: []),
			...(input.patchResult.filesChanged.length === 0
				? ['No code change landed, so this round may only provide reconnaissance value']
				: []),
			...suspiciousMetrics.map(
				(metric) => `Metric ${metric} looks unusually large and may reflect parsing noise`,
			),
		]
		return {
			verdict: concerns.length === 0 ? 'tentatively_supported' : 'needs_more_validation',
			concerns,
			suspiciousMetrics,
			recommendedFixes:
				concerns.length === 0
					? ['Proceed to the next exploit/explore round with tighter metrics collection']
					: [
							'Tighten logging, add metric sanity checks, or rerun with a smaller short-run command',
						],
		}
	}
}

export class SummarizerAgent {
	constructor(private readonly deps?: AgentDeps) {}

	async summarize(input: {
		missionTopic: string
		roundReports: string[]
		bestSoFar?: BestSoFarArtifact
		artifactIndex: Record<string, string[]>
	}): Promise<string> {
		const fallback = [
			`Problem framing: ${input.missionTopic}`,
			`Artifact coverage: ${Object.entries(input.artifactIndex)
				.map(([key, values]) => `${key}=${values.length}`)
				.join(', ')}`,
			input.bestSoFar
				? `Best method summary: ${input.bestSoFar.summary}`
				: 'Best method summary: no best-so-far artifact has been stabilized yet.',
			`Technical evolution across rounds: ${input.roundReports.slice(-3).join(' | ')}`,
			'Limitations: this summary is artifact-driven and should be refined further if a publication-grade narrative is needed.',
		]
		if (this.deps?.runModel) {
			try {
				const response = await this.deps.runModel(
					'summary',
					[
						'Write an artifact-grounded final synthesis for ClawLab.',
						`Mission topic: ${input.missionTopic}`,
						`Best so far: ${input.bestSoFar?.summary ?? 'none'}`,
						`Artifact coverage: ${Object.entries(input.artifactIndex)
							.map(([key, values]) => `${key}=${values.length}`)
							.join(', ')}`,
						`Recent round reports: ${input.roundReports.slice(-3).join('\n---\n')}`,
						'Requirements: mention limitations and open questions, avoid hype, keep claims grounded in artifacts.',
					].join('\n\n'),
				)
				if (response.content.trim()) {
					return response.content.trim()
				}
			} catch {
				// Fall back to deterministic synthesis.
			}
		}
		return fallback.join('\n\n')
	}
}
