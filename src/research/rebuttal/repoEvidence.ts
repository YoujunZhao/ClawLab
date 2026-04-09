import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { createResearchId } from '../core/ids.js'
import type { RebuttalConcern, RebuttalRepoEvidence } from './types.js'

async function listRepoFiles(root: string, limit = 250): Promise<string[]> {
	const files: string[] = []
	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true })
		for (const entry of entries) {
			if (files.length >= limit) {
				return
			}
			if (['.git', 'node_modules', 'dist', 'workspace', '.clawlab'].includes(entry.name)) {
				continue
			}
			const fullPath = join(current, entry.name)
			if (entry.isDirectory()) {
				await walk(fullPath)
				continue
			}
			files.push(fullPath)
		}
	}
	await walk(root)
	return files
}

function looksInteresting(filePath: string): boolean {
	return /(readme|train|eval|config|loss|metric|experiment|paper|method|model|result|test)/iu.test(
		filePath,
	)
}

export async function scanRepoEvidence(
	repoPath: string | undefined,
	concerns: RebuttalConcern[],
): Promise<RebuttalRepoEvidence[]> {
	if (!repoPath) {
		return []
	}
	const files = (await listRepoFiles(repoPath))
		.filter((file) => looksInteresting(file))
		.slice(0, 80)
	const keywords = Array.from(new Set(concerns.flatMap((concern) => concern.keywords))).slice(0, 20)
	const evidence: RebuttalRepoEvidence[] = []
	for (const filePath of files) {
		const extension = extname(filePath).toLowerCase()
		if (
			![
				'.ts',
				'.tsx',
				'.js',
				'.jsx',
				'.py',
				'.md',
				'.txt',
				'.json',
				'.toml',
				'.yaml',
				'.yml',
			].includes(extension)
		) {
			continue
		}
		const content = await readFile(filePath, 'utf8').catch(() => '')
		if (!content) {
			continue
		}
		const lines = content.split(/\r?\n/u)
		lines.forEach((line, index) => {
			const lowered = line.toLowerCase()
			const matchedKeywords = keywords.filter((keyword) => lowered.includes(keyword))
			if (matchedKeywords.length === 0) {
				return
			}
			evidence.push({
				id: createResearchId('evidence'),
				filePath: relative(repoPath, filePath),
				lineNumber: index + 1,
				snippet: line.trim().slice(0, 240),
				matchedKeywords: matchedKeywords.slice(0, 6),
			})
		})
	}
	return evidence.slice(0, 40)
}
