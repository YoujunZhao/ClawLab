import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LocalExecutor } from '../executors/local-executor.js'
import { SSHExecutor } from '../executors/ssh-executor.js'
import { createResearchId } from '../ids.js'
import { DisabledResearchMcpBridge } from '../mcp/researchMcpBridge.js'
import { type ModelRouter, createModelRouter } from '../model-router/modelRouter.js'
import { ResearchPermissionEngine } from '../permissions/researchPermissionEngine.js'
import {
	BudgetUsageSchema,
	type MissionArtifact,
	type ResearchPermissionMode,
	type ResearchSessionState,
	ResearchSessionStateSchema,
} from '../schemas.js'
import { ResearchArtifactStore } from '../storage/artifactStore.js'
import { ResearchMemoryStore } from '../storage/memoryStore.js'
import { ResearchTaskStore } from '../storage/taskStore.js'
import { type ResearchToolContext, ResearchToolRegistry } from '../tool-registry/toolRegistry.js'

type SessionIndex = {
	latestSessionId?: string
	sessions: Array<{
		sessionId: string
		missionId: string
		topic: string
		updatedAt: string
	}>
}

export class ResearchRuntime {
	readonly artifactStore: ResearchArtifactStore
	readonly memoryStore: ResearchMemoryStore
	readonly taskStore: ResearchTaskStore
	readonly permissionEngine: ResearchPermissionEngine
	readonly toolRegistry = new ResearchToolRegistry()
	readonly localExecutor = new LocalExecutor()
	readonly sshExecutor: SSHExecutor
	readonly modelRouter: ModelRouter
	readonly mcpBridge = new DisabledResearchMcpBridge()

	private constructor(
		readonly repoRoot: string,
		readonly sessionRoot: string,
		public state: ResearchSessionState,
	) {
		this.artifactStore = new ResearchArtifactStore(sessionRoot)
		this.memoryStore = new ResearchMemoryStore(this.artifactStore)
		this.taskStore = new ResearchTaskStore(join(sessionRoot, 'tasks'))
		this.permissionEngine = new ResearchPermissionEngine(state.permissionMode)
		const machines = new Map(state.remoteMachines.map((machine) => [machine.id, machine] as const))
		this.sshExecutor = new SSHExecutor(machines, join(sessionRoot, 'remote'))
		this.modelRouter = createModelRouter(state.modelConnection)
	}

	static sessionsRoot(repoRoot: string): string {
		return join(repoRoot, 'workspace', 'sessions')
	}

	static indexPath(repoRoot: string): string {
		return join(repoRoot, 'workspace', 'index.json')
	}

	static statePath(sessionRoot: string): string {
		return join(sessionRoot, 'state', 'session-state.json')
	}

	static async create(params: {
		repoRoot: string
		mission: MissionArtifact
		permissionMode?: ResearchPermissionMode
		remoteMachines?: ResearchSessionState['remoteMachines']
		modelConnection?: ResearchSessionState['modelConnection']
	}): Promise<ResearchRuntime> {
		const sessionId = createResearchId('session')
		const sessionRoot = join(ResearchRuntime.sessionsRoot(params.repoRoot), sessionId)
		const now = new Date().toISOString()
		const state = ResearchSessionStateSchema.parse({
			sessionId,
			missionId: params.mission.id,
			topic: params.mission.topic,
			repoPath: params.mission.repoPath ?? params.repoRoot,
			topLevelState: 'IDLE',
			runtimeMode: 'PLAN_MODE',
			permissionMode: params.permissionMode ?? 'default',
			currentRound: 0,
			readyForSummarization: false,
			userApprovedSummarization: false,
			paused: false,
			stopRequested: false,
			waitingForResources: false,
			remoteMachines: params.remoteMachines ?? [],
			modelConnection: params.modelConnection ?? params.mission.modelConnection,
			budget: params.mission.computeBudget,
			budgetUsage: BudgetUsageSchema.parse({
				startedAt: now,
				lastUpdatedAt: now,
			}),
			createdAt: now,
			updatedAt: now,
			notes: [],
		})
		const runtime = new ResearchRuntime(params.repoRoot, sessionRoot, state)
		await runtime.initialize()
		return runtime
	}

	static async load(repoRoot: string, sessionId: string): Promise<ResearchRuntime> {
		const sessionRoot = join(ResearchRuntime.sessionsRoot(repoRoot), sessionId)
		const content = await readFile(ResearchRuntime.statePath(sessionRoot), 'utf8')
		const state = ResearchSessionStateSchema.parse(JSON.parse(content))
		const runtime = new ResearchRuntime(repoRoot, sessionRoot, state)
		await runtime.artifactStore.ensureLayout()
		await runtime.taskStore.ensureLayout()
		return runtime
	}

	static async loadLatest(repoRoot: string): Promise<ResearchRuntime | null> {
		try {
			const content = await readFile(ResearchRuntime.indexPath(repoRoot), 'utf8')
			const index = JSON.parse(content) as SessionIndex
			if (!index.latestSessionId) {
				return null
			}
			return ResearchRuntime.load(repoRoot, index.latestSessionId)
		} catch {
			return null
		}
	}

	private async initialize(): Promise<void> {
		await this.artifactStore.ensureLayout()
		await this.memoryStore.initialize()
		await this.taskStore.ensureLayout()
		await Promise.all([
			this.artifactStore.writeJson('results/figures_registry.json', []),
			this.artifactStore.writeJson('results/tables_registry.json', []),
			this.artifactStore.writeJson('results/remote_run_records.json', []),
			this.artifactStore.writeJson('results/next_actions.json', []),
		])
		await this.saveState()
	}

	async saveState(): Promise<void> {
		this.state = {
			...this.state,
			updatedAt: new Date().toISOString(),
			budgetUsage: {
				...this.state.budgetUsage,
				lastUpdatedAt: new Date().toISOString(),
			},
		}
		await mkdir(join(this.sessionRoot, 'state'), { recursive: true })
		await writeFile(
			ResearchRuntime.statePath(this.sessionRoot),
			`${JSON.stringify(this.state, null, 2)}\n`,
			'utf8',
		)
		await this.updateIndex()
	}

	private async updateIndex(): Promise<void> {
		const indexPath = ResearchRuntime.indexPath(this.repoRoot)
		await mkdir(join(this.repoRoot, 'workspace'), { recursive: true })
		let index: SessionIndex = {
			sessions: [],
		}
		try {
			index = JSON.parse(await readFile(indexPath, 'utf8')) as SessionIndex
		} catch {
			index = { sessions: [] }
		}
		index.latestSessionId = this.state.sessionId
		index.sessions = [
			...index.sessions.filter((session) => session.sessionId !== this.state.sessionId),
			{
				sessionId: this.state.sessionId,
				missionId: this.state.missionId,
				topic: this.state.topic,
				updatedAt: this.state.updatedAt,
			},
		].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
	}

	setPermissionMode(mode: ResearchPermissionMode): void {
		this.permissionEngine.setMode(mode)
		this.state = {
			...this.state,
			permissionMode: mode,
		}
	}

	async updateState(updater: (state: ResearchSessionState) => ResearchSessionState): Promise<void> {
		this.state = updater(this.state)
		await this.saveState()
	}

	async persistMissionArtifacts(params: {
		missionMarkdown: string
		successCriteria: unknown
		budget: unknown
	}): Promise<void> {
		await Promise.all([
			this.artifactStore.writeText('mission/mission.md', params.missionMarkdown),
			this.artifactStore.writeJson(
				'mission/success_criteria.json',
				params.successCriteria as Record<string, unknown>,
			),
			this.artifactStore.writeJson('mission/budget.json', params.budget as Record<string, unknown>),
		])
	}

	buildToolContext(roundId: string, branchId?: string): ResearchToolContext {
		return {
			missionId: this.state.missionId,
			roundId,
			permissionMode: this.permissionEngine.getMode(),
			branchId,
			repoRoot: this.repoRoot,
			sessionState: this.state,
			artifactStore: this.artifactStore,
			memoryStore: this.memoryStore,
			taskStore: this.taskStore,
			setPermissionMode: async (mode) => {
				this.setPermissionMode(mode)
				await this.saveState()
			},
			updateSessionState: async (updater) => {
				await this.updateState(updater)
			},
		}
	}
}
