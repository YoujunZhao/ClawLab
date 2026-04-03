import type { BranchRecord, EvidenceCard, Hypothesis } from '../schemas.js'
import type { ResearchArtifactStore } from './artifactStore.js'

type TopicMemory = {
	confirmed: string[]
	mainHypothesis?: string
	mainContradictions: string[]
}

type ProjectMemory = {
	repoMapSummary: string[]
	keyFiles: string[]
	defaultCommands: string[]
	evalProtocol: string[]
	importantConfigs: string[]
}

type LoopMemory = {
	triedDirections: string[]
	failedDirections: string[]
	doNotRetry: string[]
	failureModeStats: Record<string, number>
}

type UserMemory = {
	reportStyle: string
	budgetHabit: string
	riskPreference: string
	interventionRules: string[]
	remotePreferences: string[]
}

type ExtractedMemory = {
	durableLessons: string[]
}

export class ResearchMemoryStore {
	constructor(private readonly artifactStore: ResearchArtifactStore) {}

	async initialize(): Promise<void> {
		await Promise.all([
			this.writeTopicMemory({
				confirmed: [],
				mainContradictions: [],
			}),
			this.writeProjectMemory({
				repoMapSummary: [],
				keyFiles: [],
				defaultCommands: [],
				evalProtocol: [],
				importantConfigs: [],
			}),
			this.writeLoopMemory({
				triedDirections: [],
				failedDirections: [],
				doNotRetry: [],
				failureModeStats: {},
			}),
			this.writeUserMemory({
				reportStyle: 'concise-round-report',
				budgetHabit: 'budget-aware',
				riskPreference: 'balanced',
				interventionRules: [
					'continue by default unless stop or pause is explicit',
					'summarize only after explicit approval',
				],
				remotePreferences: [],
			}),
			this.writeExtractedMemory({
				durableLessons: [],
			}),
		])
	}

	private topicPath(): string {
		return 'memory/topic-memory.json'
	}

	private projectPath(): string {
		return 'memory/project-memory.json'
	}

	private loopPath(): string {
		return 'memory/loop-memory.json'
	}

	private userPath(): string {
		return 'memory/user-memory.json'
	}

	private extractedPath(): string {
		return 'memory/extracted-memory.json'
	}

	async readTopicMemory(): Promise<TopicMemory | null> {
		return this.artifactStore.readJson<TopicMemory>(this.topicPath())
	}

	async writeTopicMemory(memory: TopicMemory): Promise<string> {
		return this.artifactStore.writeJson(this.topicPath(), memory)
	}

	async readProjectMemory(): Promise<ProjectMemory | null> {
		return this.artifactStore.readJson<ProjectMemory>(this.projectPath())
	}

	async writeProjectMemory(memory: ProjectMemory): Promise<string> {
		return this.artifactStore.writeJson(this.projectPath(), memory)
	}

	async readLoopMemory(): Promise<LoopMemory | null> {
		return this.artifactStore.readJson<LoopMemory>(this.loopPath())
	}

	async writeLoopMemory(memory: LoopMemory): Promise<string> {
		return this.artifactStore.writeJson(this.loopPath(), memory)
	}

	async readUserMemory(): Promise<UserMemory | null> {
		return this.artifactStore.readJson<UserMemory>(this.userPath())
	}

	async writeUserMemory(memory: UserMemory): Promise<string> {
		return this.artifactStore.writeJson(this.userPath(), memory)
	}

	async readExtractedMemory(): Promise<ExtractedMemory | null> {
		return this.artifactStore.readJson<ExtractedMemory>(this.extractedPath())
	}

	async writeExtractedMemory(memory: ExtractedMemory): Promise<string> {
		return this.artifactStore.writeJson(this.extractedPath(), memory)
	}

	async noteEvidence(evidence: EvidenceCard[]): Promise<void> {
		const topic = (await this.readTopicMemory()) ?? {
			confirmed: [],
			mainContradictions: [],
		}
		const confirmed = new Set(topic.confirmed)
		for (const card of evidence) {
			confirmed.add(card.claim)
		}
		await this.writeTopicMemory({
			...topic,
			confirmed: Array.from(confirmed).slice(-50),
		})
	}

	async noteRepoMap(repoMap: {
		keyFiles: string[]
		commands: string[]
		configs: string[]
		summary: string[]
	}): Promise<void> {
		const project = (await this.readProjectMemory()) ?? {
			repoMapSummary: [],
			keyFiles: [],
			defaultCommands: [],
			evalProtocol: [],
			importantConfigs: [],
		}
		await this.writeProjectMemory({
			...project,
			repoMapSummary: repoMap.summary,
			keyFiles: repoMap.keyFiles,
			defaultCommands: repoMap.commands,
			importantConfigs: repoMap.configs,
		})
	}

	async noteLoopUpdate(update: {
		triedDirection?: string
		failedDirection?: string
		failureClass?: string
		noRetryDirection?: string
	}): Promise<void> {
		const loop = (await this.readLoopMemory()) ?? {
			triedDirections: [],
			failedDirections: [],
			doNotRetry: [],
			failureModeStats: {},
		}
		if (update.triedDirection) {
			loop.triedDirections = Array.from(new Set([...loop.triedDirections, update.triedDirection]))
		}
		if (update.failedDirection) {
			loop.failedDirections = Array.from(
				new Set([...loop.failedDirections, update.failedDirection]),
			)
		}
		if (update.noRetryDirection) {
			loop.doNotRetry = Array.from(new Set([...loop.doNotRetry, update.noRetryDirection]))
		}
		if (update.failureClass) {
			loop.failureModeStats[update.failureClass] =
				(loop.failureModeStats[update.failureClass] ?? 0) + 1
		}
		await this.writeLoopMemory(loop)
	}

	async noteBestSoFarUpdate(update: {
		hypothesis?: Hypothesis
		branch?: BranchRecord
		lesson?: string
	}): Promise<void> {
		const extracted = (await this.readExtractedMemory()) ?? {
			durableLessons: [],
		}
		const additions = [update.hypothesis?.description, update.branch?.name, update.lesson]
			.filter((value): value is string => Boolean(value))
			.map((value) => value.trim())
		if (additions.length === 0) {
			return
		}
		extracted.durableLessons = Array.from(
			new Set([...extracted.durableLessons, ...additions]),
		).slice(-100)
		await this.writeExtractedMemory(extracted)
	}
}
