import type { ToolRunner } from '../agents/researchAgents.js'
import type { BestSoFarArtifact, UserRoundReport } from '../core/schemas.js'

export class ReportingLoop {
	constructor(private readonly runTool: ToolRunner) {}

	async writeRoundReport(
		roundId: string,
		report: UserRoundReport,
		bestSoFar?: BestSoFarArtifact,
	): Promise<{ content: string; reportPath: string }> {
		const reportResult = await this.runTool<
			{ report: UserRoundReport },
			{ path: string; content: string }
		>('research_round_report_writer', { report }, roundId)
		if (bestSoFar) {
			await this.runTool('best_so_far_writer', { artifact: bestSoFar }, roundId)
		}
		return {
			content: reportResult.content,
			reportPath: reportResult.path,
		}
	}
}
