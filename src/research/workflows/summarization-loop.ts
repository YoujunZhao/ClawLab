import { SummarizerAgent, type ToolRunner } from '../agents/researchAgents.js'
import type { ModelResponse, ModelTask } from '../core/model-router/modelRouter.js'
import type { BestSoFarArtifact } from '../core/schemas.js'

type SummarizationPhase = 'ARTIFACT_AGGREGATION' | 'NARRATIVE_SYNTHESIS' | 'FINAL_REPORT_DRAFTING'

export class SummarizationLoop {
	private readonly summarizer: SummarizerAgent

	constructor(
		private readonly runTool: ToolRunner,
		runModel?: (task: ModelTask, prompt: string) => Promise<ModelResponse>,
	) {
		this.summarizer = new SummarizerAgent({ runTool, runModel })
	}

	async run(input: {
		roundId: string
		missionTopic: string
		type: 'summary' | 'report' | 'paper_draft'
		roundReports: string[]
		bestSoFar?: BestSoFarArtifact
		onPhaseChange?: (phase: SummarizationPhase) => Promise<void>
	}): Promise<{ path: string; content: string }> {
		await input.onPhaseChange?.('ARTIFACT_AGGREGATION')
		const artifactIndex = await this.runTool<Record<string, never>, Record<string, string[]>>(
			'artifact_aggregator',
			{},
			input.roundId,
		)
		await input.onPhaseChange?.('NARRATIVE_SYNTHESIS')
		const content = await this.summarizer.summarize({
			missionTopic: input.missionTopic,
			roundReports: input.roundReports,
			bestSoFar: input.bestSoFar,
			artifactIndex,
		})
		await input.onPhaseChange?.('FINAL_REPORT_DRAFTING')
		if (input.type === 'summary') {
			return this.runTool<{ title: string; content: string }, { path: string; content: string }>(
				'final_summary_writer',
				{
					title: `${input.missionTopic} summary`,
					content,
				},
				input.roundId,
			)
		}
		if (input.type === 'paper_draft') {
			return this.runTool<{ title: string; content: string }, { path: string; content: string }>(
				'paper_draft_writer',
				{
					title: `${input.missionTopic} paper draft`,
					content,
				},
				input.roundId,
			)
		}
		return this.runTool<{ title: string; content: string }, { path: string; content: string }>(
			'final_report_writer',
			{
				title: `${input.missionTopic} report`,
				content,
			},
			input.roundId,
		)
	}
}
