import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type JsonRecord = Record<string, unknown> | unknown[]

export type ResearchSessionPaths = {
	root: string
	mission: string
	sources: string
	evidence: string
	repoMap: string
	branches: string
	patches: string
	runs: string
	logs: string
	results: string
	figures: string
	tables: string
	reports: string
	summaries: string
	memory: string
	remote: string
	tasks: string
	trace: string
	state: string
}

function stringifyJson(value: JsonRecord): string {
	return `${JSON.stringify(value, null, 2)}\n`
}

export class ResearchArtifactStore {
	readonly paths: ResearchSessionPaths

	constructor(public readonly sessionRoot: string) {
		this.paths = {
			root: sessionRoot,
			mission: join(sessionRoot, 'mission'),
			sources: join(sessionRoot, 'sources'),
			evidence: join(sessionRoot, 'evidence'),
			repoMap: join(sessionRoot, 'repo_map'),
			branches: join(sessionRoot, 'branches'),
			patches: join(sessionRoot, 'patches'),
			runs: join(sessionRoot, 'runs'),
			logs: join(sessionRoot, 'logs'),
			results: join(sessionRoot, 'results'),
			figures: join(sessionRoot, 'figures'),
			tables: join(sessionRoot, 'tables'),
			reports: join(sessionRoot, 'reports'),
			summaries: join(sessionRoot, 'summaries'),
			memory: join(sessionRoot, 'memory'),
			remote: join(sessionRoot, 'remote'),
			tasks: join(sessionRoot, 'tasks'),
			trace: join(sessionRoot, 'trace'),
			state: join(sessionRoot, 'state'),
		}
	}

	async ensureLayout(): Promise<void> {
		await Promise.all(Object.values(this.paths).map((path) => mkdir(path, { recursive: true })))
	}

	async writeJson(relativePath: string, value: JsonRecord): Promise<string> {
		const target = join(this.sessionRoot, relativePath)
		await mkdir(dirname(target), { recursive: true })
		await writeFile(target, stringifyJson(value), 'utf8')
		return target
	}

	async writeText(relativePath: string, value: string): Promise<string> {
		const target = join(this.sessionRoot, relativePath)
		await mkdir(dirname(target), { recursive: true })
		await writeFile(target, value.endsWith('\n') ? value : `${value}\n`, 'utf8')
		return target
	}

	async appendJsonl(relativePath: string, value: unknown): Promise<string> {
		const target = join(this.sessionRoot, relativePath)
		await mkdir(dirname(target), { recursive: true })
		let existing = ''
		try {
			existing = await readFile(target, 'utf8')
		} catch {
			existing = ''
		}
		const nextLine = `${JSON.stringify(value)}\n`
		await writeFile(target, `${existing}${nextLine}`, 'utf8')
		return target
	}

	async readJson<T>(relativePath: string): Promise<T | null> {
		try {
			const content = await readFile(join(this.sessionRoot, relativePath), 'utf8')
			return JSON.parse(content) as T
		} catch {
			return null
		}
	}

	async readText(relativePath: string): Promise<string | null> {
		try {
			return await readFile(join(this.sessionRoot, relativePath), 'utf8')
		} catch {
			return null
		}
	}

	async list(relativePath: string): Promise<string[]> {
		try {
			return await readdir(join(this.sessionRoot, relativePath))
		} catch {
			return []
		}
	}
}
