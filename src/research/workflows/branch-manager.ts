import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execa } from 'execa'
import { createResearchId } from '../core/ids.js'
import type { BranchRecord, Hypothesis, ResearchBranchKind } from '../core/schemas.js'
import type { ResearchArtifactStore } from '../core/storage/artifactStore.js'

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		const info = await stat(path)
		return info.isDirectory()
	} catch {
		return false
	}
}

function shouldCopyPath(sourcePath: string): boolean {
	return (
		!/[\\/]node_modules([\\/]|$)/u.test(sourcePath) &&
		!/[\\/]workspace([\\/]|$)/u.test(sourcePath) &&
		!/[\\/]\.git([\\/]|$)/u.test(sourcePath) &&
		!/[\\/]dist([\\/]|$)/u.test(sourcePath)
	)
}

export class BranchManager {
	constructor(
		private readonly repoRoot: string,
		private readonly artifactStore: ResearchArtifactStore,
	) {}

	private branchesPath(): string {
		return 'branches/active_branches.json'
	}

	async list(): Promise<BranchRecord[]> {
		return (await this.artifactStore.readJson<BranchRecord[]>(this.branchesPath())) ?? []
	}

	async save(branches: BranchRecord[]): Promise<void> {
		await this.artifactStore.writeJson(this.branchesPath(), branches)
	}

	async selectBranch(input: {
		preferredKind: ResearchBranchKind
		hypothesis: Hypothesis
	}): Promise<BranchRecord> {
		const existing = await this.list()
		const replacedBranch = existing.find((branch) => branch.kind === input.preferredKind)

		const branchId = createResearchId('branch')
		const worktreePath = join(this.artifactStore.paths.branches, branchId, 'worktree')
		const branch: BranchRecord = {
			id: branchId,
			name: `${input.preferredKind}-${input.hypothesis.id.slice(-4)}`,
			kind: input.preferredKind,
			hypothesisIds: [input.hypothesis.id],
			worktreePath,
			status: 'active',
			notes: replacedBranch
				? [
						`Replaced ${replacedBranch.name} to keep ${input.hypothesis.id} isolated in a fresh worktree.`,
					]
				: [],
		}
		const nextBranches = [
			...existing.filter((current) => current.kind !== input.preferredKind),
			branch,
		].slice(-3)
		await this.save(nextBranches)
		await this.ensureWorktree(branch)
		return branch
	}

	async markFailed(branchId: string, note: string): Promise<void> {
		const branches = await this.list()
		await this.save(
			branches.map((branch) =>
				branch.id === branchId
					? {
							...branch,
							status: 'failed',
							notes: [...branch.notes, note],
						}
					: branch,
			),
		)
	}

	async ensureWorktree(branch: BranchRecord): Promise<void> {
		if (await directoryExists(branch.worktreePath)) {
			return
		}
		if (await pathExists(join(this.repoRoot, '.git'))) {
			try {
				await execa('git', ['worktree', 'add', '--detach', branch.worktreePath], {
					cwd: this.repoRoot,
				})
				return
			} catch {
				// Fall through to copy-based isolation.
			}
		}
		await mkdir(branch.worktreePath, { recursive: true })
		const entries = await readdir(this.repoRoot, { withFileTypes: true })
		for (const entry of entries) {
			const sourcePath = join(this.repoRoot, entry.name)
			if (!shouldCopyPath(sourcePath)) {
				continue
			}
			await cp(sourcePath, join(branch.worktreePath, entry.name), {
				recursive: true,
				filter: shouldCopyPath,
			})
		}
	}
}
