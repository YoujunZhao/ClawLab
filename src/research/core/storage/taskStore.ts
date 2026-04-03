import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ResearchTask, ResearchTaskSchema } from '../schemas.js'

function sortByUpdatedAtDesc(tasks: ResearchTask[]): ResearchTask[] {
	return [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export class ResearchTaskStore {
	constructor(private readonly tasksRoot: string) {}

	async ensureLayout(): Promise<void> {
		await mkdir(this.tasksRoot, { recursive: true })
	}

	async create(task: ResearchTask): Promise<ResearchTask> {
		await this.ensureLayout()
		await writeFile(
			join(this.tasksRoot, `${task.id}.json`),
			`${JSON.stringify(task, null, 2)}\n`,
			'utf8',
		)
		return task
	}

	async get(taskId: string): Promise<ResearchTask | null> {
		try {
			const content = await readFile(join(this.tasksRoot, `${taskId}.json`), 'utf8')
			const parsed = ResearchTaskSchema.safeParse(JSON.parse(content))
			return parsed.success ? parsed.data : null
		} catch {
			return null
		}
	}

	async list(): Promise<ResearchTask[]> {
		await this.ensureLayout()
		const files = await readdir(this.tasksRoot)
		const tasks = await Promise.all(
			files
				.filter((file) => file.endsWith('.json'))
				.map((file) => this.get(file.replace(/\.json$/u, ''))),
		)
		return sortByUpdatedAtDesc(tasks.filter((task): task is ResearchTask => Boolean(task)))
	}

	async update(taskId: string, updates: Partial<ResearchTask>): Promise<ResearchTask | null> {
		const existing = await this.get(taskId)
		if (!existing) {
			return null
		}
		const next = ResearchTaskSchema.parse({
			...existing,
			...updates,
			id: existing.id,
			updatedAt: new Date().toISOString(),
		})
		await writeFile(
			join(this.tasksRoot, `${taskId}.json`),
			`${JSON.stringify(next, null, 2)}\n`,
			'utf8',
		)
		return next
	}

	async stop(taskId: string): Promise<ResearchTask | null> {
		return this.update(taskId, {
			status: 'cancelled',
		})
	}
}
