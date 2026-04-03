import type { ResearchArtifactStore } from '../storage/artifactStore.js'

export class TraceLogger {
	constructor(private readonly artifactStore: ResearchArtifactStore) {}

	async log(event: {
		type: string
		roundId?: string
		state?: string
		data?: Record<string, unknown>
	}): Promise<void> {
		await this.artifactStore.appendJsonl('trace/trace.ndjson', {
			timestamp: new Date().toISOString(),
			...event,
		})
	}
}
