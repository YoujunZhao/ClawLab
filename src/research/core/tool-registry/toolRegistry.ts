import type { BranchRecord, ResearchPermissionMode, ResearchSessionState } from '../schemas.js'
import type { ResearchArtifactStore } from '../storage/artifactStore.js'
import type { ResearchMemoryStore } from '../storage/memoryStore.js'
import type { ResearchTaskStore } from '../storage/taskStore.js'

export type ResearchToolCategory =
	| 'evidence'
	| 'repo-read'
	| 'repo-write'
	| 'experiment'
	| 'remote'
	| 'report'
	| 'summarize'
	| 'orchestration-read'
	| 'orchestration-write'

export type ResearchToolContext = {
	missionId: string
	roundId: string
	permissionMode: ResearchPermissionMode
	branchId?: string
	repoRoot: string
	sessionState: ResearchSessionState
	artifactStore: ResearchArtifactStore
	memoryStore: ResearchMemoryStore
	taskStore: ResearchTaskStore
	activeBranch?: BranchRecord
	setPermissionMode?: (mode: ResearchPermissionMode) => Promise<void> | void
	updateSessionState?: (
		updater: (state: ResearchSessionState) => ResearchSessionState,
	) => Promise<void>
}

export type ResearchTool<Input, Output> = {
	name: string
	description: string
	isReadOnly: boolean
	requiresApproval: boolean
	categories: readonly ResearchToolCategory[]
	run(input: Input, context: ResearchToolContext): Promise<Output>
}

export class ResearchToolRegistry {
	private readonly tools = new Map<string, ResearchTool<unknown, unknown>>()

	register<Input, Output>(tool: ResearchTool<Input, Output>): void {
		this.tools.set(tool.name, tool as ResearchTool<unknown, unknown>)
	}

	get<Input, Output>(name: string): ResearchTool<Input, Output> | undefined {
		return this.tools.get(name) as ResearchTool<Input, Output> | undefined
	}

	list(): ResearchTool<unknown, unknown>[] {
		return Array.from(this.tools.values())
	}
}
