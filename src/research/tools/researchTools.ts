import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { createResearchId, createRoundLabel, createRunLabel } from '../core/ids.js'
import type { ResearchRuntime } from '../core/runtime/researchRuntime.js'
import type { BranchRecord, EvidenceCard, Hypothesis, ResearchTask } from '../core/schemas.js'
import type { ResearchTool, ResearchToolContext } from '../core/tool-registry/toolRegistry.js'
import type { BranchManager } from '../workflows/branch-manager.js'

function nowIso(): string {
	return new Date().toISOString()
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await readFile(path, 'utf8')
		return true
	} catch {
		return false
	}
}

async function listFiles(root: string, limit = 250): Promise<string[]> {
	const results: string[] = []
	async function walk(current: string): Promise<void> {
		if (results.length >= limit) return
		const entries = await readdir(current, { withFileTypes: true })
		for (const entry of entries) {
			if (results.length >= limit) return
			if (['node_modules', '.git', 'workspace', 'dist'].includes(entry.name)) {
				continue
			}
			const fullPath = join(current, entry.name)
			if (entry.isDirectory()) {
				await walk(fullPath)
			} else {
				results.push(fullPath)
			}
		}
	}
	await walk(root)
	return results
}

function stripHtml(text: string): string {
	return text
		.replace(/<script[\s\S]*?<\/script>/giu, ' ')
		.replace(/<style[\s\S]*?<\/style>/giu, ' ')
		.replace(/<[^>]+>/gu, ' ')
		.replace(/&nbsp;/gu, ' ')
		.replace(/&amp;/gu, '&')
		.replace(/\s+/gu, ' ')
		.trim()
}

function parseMetricsFromText(text: string): Record<string, number> {
	const metrics: Record<string, number> = {}
	const regex = /([A-Za-z][A-Za-z0-9_.-]{1,40})\s*[:=]\s*(-?\d+(?:\.\d+)?)/gu
	for (const match of text.matchAll(regex)) {
		metrics[match[1]] = Number(match[2])
	}
	return metrics
}

function classifyFailure(text: string): string {
	const haystack = text.toLowerCase()
	if (/syntaxerror|cannot find module|importerror|module not found/u.test(haystack))
		return 'syntax_import'
	if (/no module named|dependency|config|toml|yaml|jsondecode/u.test(haystack))
		return 'dependency_config'
	if (/file not found|dataset|permission denied|no such file|data/u.test(haystack))
		return 'data_issue'
	if (/out of memory|oom|cuda out of memory/u.test(haystack)) return 'oom_resource'
	if (/metric|nan|overflow|division by zero/u.test(haystack)) return 'metric_bug'
	if (/flaky|unstable|diverged|explod/u.test(haystack)) return 'instability'
	if (/regression|worse|decrease/u.test(haystack)) return 'regression'
	return 'inconclusive'
}

function summarizeDiff(before: string, after: string): string {
	const beforeLines = before.split(/\r?\n/u)
	const afterLines = after.split(/\r?\n/u)
	return `Lines before: ${beforeLines.length}; lines after: ${afterLines.length}; delta: ${afterLines.length - beforeLines.length}`
}

async function detectRepoMap(root: string): Promise<{
	summary: string[]
	keyFiles: string[]
	commands: string[]
	configs: string[]
}> {
	const files = await listFiles(root, 300)
	const relativeFiles = files.map((file) => relative(root, file))
	const keyFiles = relativeFiles.filter((file) =>
		/(package\.json|README|pyproject\.toml|requirements\.txt|train|eval|config|tsconfig|biome|Dockerfile)/iu.test(
			file,
		),
	)
	const configs = keyFiles.filter((file) => /(json|ya?ml|toml|ini|cfg)$/iu.test(file))
	const commands: string[] = []
	if (await fileExists(join(root, 'package.json'))) {
		try {
			const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
				scripts?: Record<string, string>
			}
			for (const scriptName of Object.keys(packageJson.scripts ?? {})) {
				commands.push(`npm run ${scriptName}`)
			}
		} catch {
			// Ignore malformed package.json.
		}
	}
	const summary = [
		`Indexed ${relativeFiles.length} files for repo reconnaissance`,
		keyFiles.length > 0
			? `Key files: ${keyFiles.slice(0, 12).join(', ')}`
			: 'No obvious training or config files detected yet',
		commands.length > 0
			? `Detected commands: ${commands.slice(0, 8).join(', ')}`
			: 'No package scripts detected',
	]
	return { summary, keyFiles, commands, configs }
}

async function aggregateSessionArtifacts(
	context: ResearchToolContext,
): Promise<Record<string, string[]>> {
	return {
		mission: await context.artifactStore.list('mission'),
		sources: await context.artifactStore.list('sources'),
		evidence: await context.artifactStore.list('evidence'),
		branches: await context.artifactStore.list('branches'),
		patches: await context.artifactStore.list('patches'),
		runs: await context.artifactStore.list('runs'),
		results: await context.artifactStore.list('results'),
		reports: await context.artifactStore.list('reports'),
		summaries: await context.artifactStore.list('summaries'),
		memory: await context.artifactStore.list('memory'),
	}
}

export function formatRoundReport(report: {
	roundId: string
	objective: string
	researchSummary: string[]
	evidenceAdded: string[]
	codeChanges: string[]
	experimentsRun: string[]
	keyResults: string[]
	failuresAndFixes: string[]
	currentBestSoFar: string
	uncertainties: string[]
	nextRoundPlan: string[]
	executionEnvironmentSummary: string[]
}): string {
	const sections: Array<[string, string[]]> = [
		['1. \u672c\u8f6e\u76ee\u6807', [report.objective]],
		['2. \u672c\u8f6e\u8c03\u7814\u53d1\u73b0', report.researchSummary],
		['3. \u672c\u8f6e\u65b0\u589e\u8bc1\u636e', report.evidenceAdded],
		['4. \u672c\u8f6e\u4ee3\u7801\u6539\u52a8', report.codeChanges],
		['5. \u672c\u8f6e\u5b9e\u9a8c', report.experimentsRun],
		['6. \u672c\u8f6e\u5173\u952e\u7ed3\u679c', report.keyResults],
		['7. \u672c\u8f6e\u5931\u8d25\u4e0e\u4fee\u590d', report.failuresAndFixes],
		['8. \u5f53\u524d best-so-far', [report.currentBestSoFar]],
		['9. \u5f53\u524d\u4e0d\u786e\u5b9a\u70b9', report.uncertainties],
		['10. \u4e0b\u4e00\u8f6e\u8ba1\u5212', report.nextRoundPlan],
		['11. \u672c\u8f6e\u6267\u884c\u73af\u5883', report.executionEnvironmentSummary],
	]
	return sections
		.map(([title, lines]) => {
			const body = lines.length > 0 ? lines.map((line) => `- ${line}`).join('\n') : '- \u65e0'
			return `${title}\n${body}`
		})
		.join('\n\n')
}

export function registerResearchTools(params: {
	runtime: ResearchRuntime
	branchManager: BranchManager
}): void {
	const { runtime, branchManager } = params
	const register = <Input, Output>(tool: ResearchTool<Input, Output>) =>
		runtime.toolRegistry.register(tool)

	register({
		name: 'web_search',
		description: 'Search the web for research context',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['evidence'],
		async run(input: { query: string; limit?: number }, context) {
			const response = await fetch(
				`https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`,
			)
			const html = await response.text()
			const matches = Array.from(
				html.matchAll(
					/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>(.*?)<\/a>|class="result__snippet"[^>]*>(.*?)<\/div>)/giu,
				),
			).slice(0, input.limit ?? 5)
			const results = matches.map((match) => ({
				id: createResearchId('src'),
				url: match[1],
				title: stripHtml(match[2]),
				snippet: stripHtml(match[3] ?? match[4] ?? ''),
				sourceType: 'web' as const,
				fetchedAt: nowIso(),
			}))
			for (const result of results) {
				await context.artifactStore.appendJsonl('sources/sources.jsonl', result)
			}
			return { results }
		},
	})

	register({
		name: 'paper_search',
		description: 'Search arXiv papers for a topic',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['evidence'],
		async run(input: { query: string; limit?: number }, context) {
			const response = await fetch(
				`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(input.query)}&start=0&max_results=${input.limit ?? 5}`,
			)
			const xml = await response.text()
			const entries = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/giu))
			const results = entries.map((entry) => {
				const block = entry[1]
				const title = block.match(/<title>([\s\S]*?)<\/title>/iu)?.[1]?.trim() ?? 'Untitled'
				const url = block.match(/<id>([\s\S]*?)<\/id>/iu)?.[1]?.trim() ?? ''
				const snippet = block.match(/<summary>([\s\S]*?)<\/summary>/iu)?.[1]?.trim() ?? ''
				const authors = Array.from(block.matchAll(/<name>([\s\S]*?)<\/name>/giu)).map((match) =>
					match[1].trim(),
				)
				return {
					id: createResearchId('paper'),
					url,
					title,
					snippet,
					sourceType: 'paper' as const,
					authors,
					fetchedAt: nowIso(),
				}
			})
			for (const result of results) {
				await context.artifactStore.appendJsonl('sources/sources.jsonl', result)
			}
			return { results }
		},
	})

	register({
		name: 'web_fetch',
		description: 'Fetch a web page or text artifact',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['evidence'],
		async run(input: { url: string }) {
			const response = await fetch(input.url)
			const text = await response.text()
			return {
				url: input.url,
				status: response.status,
				content: stripHtml(text),
			}
		},
	})

	register({
		name: 'pdf_reader',
		description: 'Read a PDF artifact into a rough text form',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['evidence'],
		async run(input: { url?: string; path?: string }) {
			if (!input.url && !input.path) {
				throw new Error('pdf_reader requires either a url or path')
			}
			const buffer = input.url
				? Buffer.from(await (await fetch(input.url)).arrayBuffer())
				: await readFile(input.path!)
			return {
				extractedText: buffer
					.toString('utf8')
					.replace(/[^\t\n\r -~]+/gu, ' ')
					.replace(/\s+/gu, ' ')
					.slice(0, 20_000),
			}
		},
	})

	register({
		name: 'citation_extractor',
		description: 'Extract lightweight citation references from text',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['evidence'],
		async run(input: { text: string; sourceUrl?: string }) {
			const citations = input.text
				.split(/\.\s+/u)
				.map((sentence) => sentence.trim())
				.filter((sentence) => sentence.length > 20)
				.slice(0, 10)
				.map((sentence) => ({
					id: createResearchId('cite'),
					title: sentence.slice(0, 120),
					url: input.sourceUrl,
				}))
			return { citations }
		},
	})

	register({
		name: 'evidence_writer',
		description: 'Write evidence cards into the evidence bank',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['evidence'],
		async run(input: { cards: EvidenceCard[] }, context) {
			for (const card of input.cards) {
				await context.artifactStore.appendJsonl('evidence/evidence_bank.jsonl', card)
			}
			await context.memoryStore.noteEvidence(input.cards)
			return {
				count: input.cards.length,
				path: join(context.artifactStore.paths.evidence, 'evidence_bank.jsonl'),
			}
		},
	})

	register({
		name: 'repo_map',
		description: 'Summarize the repository layout and key commands',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['repo-read'],
		async run(input: { root?: string }, context) {
			const summary = await detectRepoMap(input.root ?? context.repoRoot)
			await context.artifactStore.writeJson('repo_map/repo_map.json', summary)
			await context.memoryStore.noteRepoMap(summary)
			return summary
		},
	})

	register({
		name: 'file_read',
		description: 'Read a file from a repo or worktree',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['repo-read'],
		async run(input: { filePath: string }) {
			return {
				content: await readFile(input.filePath, 'utf8'),
			}
		},
	})

	register({
		name: 'grep',
		description: 'Search across files in a repo or worktree',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['repo-read'],
		async run(input: { pattern: string; root?: string }, context) {
			const files = await listFiles(input.root ?? context.repoRoot, 250)
			const matches: Array<{ filePath: string; lineNumber: number; line: string }> = []
			const regex = new RegExp(input.pattern, 'iu')
			for (const filePath of files) {
				const content = await readFile(filePath, 'utf8').catch(() => '')
				const lines = content.split(/\r?\n/u)
				lines.forEach((line, index) => {
					if (regex.test(line)) {
						matches.push({ filePath, lineNumber: index + 1, line })
					}
				})
			}
			return { matches: matches.slice(0, 200) }
		},
	})

	register({
		name: 'symbol_search',
		description: 'Search for a function, class, type, or symbol name',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['repo-read'],
		async run(input: { symbol: string; root?: string }, context) {
			const pattern = `(function|class|interface|type|const|let|var)\\s+${input.symbol}`
			const grepTool = runtime.toolRegistry.get<
				{ pattern: string; root?: string },
				{ matches: Array<{ filePath: string; lineNumber: number; line: string }> }
			>('grep')
			if (!grepTool) {
				throw new Error('grep tool is unavailable')
			}
			return grepTool.run({ pattern, root: input.root }, context)
		},
	})

	register({
		name: 'patch_apply',
		description: 'Apply a small deterministic patch to a file',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['repo-write'],
		async run(
			input: {
				filePath: string
				mode: 'replace' | 'append' | 'create'
				search?: string
				replacement?: string
				content?: string
			},
			context,
		) {
			let before = ''
			if (await fileExists(input.filePath)) {
				before = await readFile(input.filePath, 'utf8')
			}
			let after = before
			if (input.mode === 'replace') {
				if (input.search === undefined || input.replacement === undefined) {
					throw new Error('replace mode requires search and replacement')
				}
				after = before.replace(input.search, input.replacement)
			} else if (input.mode === 'append') {
				after = `${before}${input.content ?? ''}`
			} else {
				after = input.content ?? ''
			}
			await mkdir(dirname(input.filePath), { recursive: true })
			await writeFile(input.filePath, after, 'utf8')
			const diff = [
				`--- ${input.filePath}`,
				`+++ ${input.filePath}`,
				'@@',
				`- ${before.slice(0, 1000)}`,
				`+ ${after.slice(0, 1000)}`,
			].join('\n')
			const diffPath = `patches/${createRoundLabel(context.sessionState.currentRound || 1)}/${basename(input.filePath)}.diff`
			await context.artifactStore.writeText(diffPath, diff)
			return {
				success: true,
				filePath: input.filePath,
				diffPath: join(context.artifactStore.sessionRoot, diffPath),
				diffSummary: summarizeDiff(before, after),
			}
		},
	})

	register({
		name: 'config_edit',
		description: 'Edit a JSON config file with shallow updates',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['repo-write'],
		async run(input: { filePath: string; updates: Record<string, unknown> }, context) {
			const before = (await readFile(input.filePath, 'utf8').catch(() => '{}')) || '{}'
			const json = JSON.parse(before) as Record<string, unknown>
			const afterJson = { ...json, ...input.updates }
			const after = `${JSON.stringify(afterJson, null, 2)}\n`
			await writeFile(input.filePath, after, 'utf8')
			const diffPath = `patches/${createRoundLabel(context.sessionState.currentRound || 1)}/${basename(input.filePath)}.diff`
			await context.artifactStore.writeText(
				diffPath,
				`--- ${input.filePath}\n+++ ${input.filePath}\n${JSON.stringify(input.updates, null, 2)}`,
			)
			return {
				success: true,
				filePath: input.filePath,
				diffPath: join(context.artifactStore.sessionRoot, diffPath),
			}
		},
	})

	register({
		name: 'diff_summary',
		description: 'Summarize before/after content changes',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['repo-read'],
		async run(input: { before: string; after: string }) {
			return {
				summary: summarizeDiff(input.before, input.after),
			}
		},
	})

	register({
		name: 'worktree_manager',
		description: 'Create or inspect branch-isolated worktrees',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['repo-write'],
		async run(
			input:
				| { action: 'list' }
				| {
						action: 'ensure'
						preferredKind: BranchRecord['kind']
						hypothesis: Hypothesis
				  }
				| { action: 'fail'; branchId: string; note: string },
		) {
			if (input.action === 'list') {
				return { branches: await branchManager.list() }
			}
			if (input.action === 'fail') {
				await branchManager.markFailed(input.branchId, input.note)
				return { success: true }
			}
			return {
				branch: await branchManager.selectBranch({
					preferredKind: input.preferredKind,
					hypothesis: input.hypothesis,
				}),
			}
		},
	})

	register({
		name: 'experiment_plan_writer',
		description: 'Persist an experiment plan',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['experiment'],
		async run(
			input: {
				plan: {
					id: string
					[key: string]: unknown
				}
			},
			context,
		) {
			const path = `runs/${input.plan.id}/experiment_plan.json`
			await context.artifactStore.writeJson(path, input.plan)
			return { path: join(context.artifactStore.sessionRoot, path) }
		},
	})

	register({
		name: 'smoke_run',
		description: 'Run smoke checks before a short/full experiment',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['experiment'],
		async run(
			input: {
				commands: string[]
				executionTarget: {
					type: 'local' | 'ssh'
					machineId?: string
					cwd: string
					gpuAllocation?: {
						mode: 'auto' | 'manual'
						visibleDevices?: string
					}
				}
			},
			context,
		) {
			const executor =
				input.executionTarget.type === 'ssh' ? runtime.sshExecutor : runtime.localExecutor
			await executor.prepareEnvironment(input.executionTarget)
			const checks: Array<{
				name: string
				command: string
				success: boolean
				stdout: string
				stderr: string
			}> = []
			for (const command of input.commands) {
				const result = await executor.runCommand(input.executionTarget, command)
				checks.push({
					name: command,
					command,
					success: result.success,
					stdout: result.stdout,
					stderr: result.stderr,
				})
			}
			const smoke = {
				success: checks.every((check) => check.success),
				checks,
			}
			await context.artifactStore.writeJson(
				'results/smoke_results.json',
				smoke as unknown as Record<string, unknown>,
			)
			return smoke
		},
	})

	register({
		name: 'job_launch',
		description: 'Launch a short or full experiment run',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['experiment'],
		async run(
			input: {
				command: string
				executionTarget: {
					type: 'local' | 'ssh'
					machineId?: string
					cwd: string
					gpuAllocation?: {
						mode: 'auto' | 'manual'
						visibleDevices?: string
					}
				}
				background?: boolean
			},
			context,
		) {
			const executor =
				input.executionTarget.type === 'ssh' ? runtime.sshExecutor : runtime.localExecutor
			const runId = createRunLabel(context.sessionState.budgetUsage.experimentsUsed + 1)
			if (input.background) {
				const result = await executor.runBackgroundCommand(input.executionTarget, input.command)
				return {
					runId,
					status: 'running',
					...result,
				}
			}
			const result = await executor.runCommand(input.executionTarget, input.command)
			return {
				runId,
				status: result.success ? 'done' : 'failed',
				stdout: result.stdout,
				stderr: result.stderr,
			}
		},
	})

	register({
		name: 'log_watch',
		description: 'Watch or tail an experiment log',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['experiment'],
		async run(input: {
			logPath: string
			executionTarget: {
				type: 'local' | 'ssh'
				machineId?: string
				cwd: string
				gpuAllocation?: {
					mode: 'auto' | 'manual'
					visibleDevices?: string
				}
			}
		}) {
			const executor =
				input.executionTarget.type === 'ssh' ? runtime.sshExecutor : runtime.localExecutor
			return {
				content: await executor.streamLogs(input.executionTarget, input.logPath),
			}
		},
	})

	register({
		name: 'metric_parser',
		description: 'Extract numeric metrics from logs or output',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['experiment'],
		async run(input: { text: string }) {
			return {
				metrics: parseMetricsFromText(input.text),
			}
		},
	})

	register({
		name: 'result_compare',
		description: 'Compare baseline and candidate metric sets',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['experiment'],
		async run(input: { baseline: Record<string, number>; candidate: Record<string, number> }) {
			const deltas: Record<string, number> = {}
			for (const [metric, value] of Object.entries(input.candidate)) {
				deltas[metric] = value - (input.baseline[metric] ?? 0)
			}
			const improvements = Object.values(deltas).filter((value) => value > 0).length
			return {
				metricDeltas: deltas,
				verdict: improvements > 0 ? 'candidate-better-on-some-metrics' : 'no-clear-improvement',
			}
		},
	})

	register({
		name: 'failure_classifier',
		description: 'Classify run failures into the research loop taxonomy',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['experiment'],
		async run(input: { text: string }) {
			return {
				failureClass: classifyFailure(input.text),
			}
		},
	})

	register({
		name: 'ssh_connect',
		description: 'Check SSH connectivity to a remote machine',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: { target: { type: 'ssh'; machineId?: string; cwd: string } }) {
			await runtime.sshExecutor.prepareEnvironment(input.target)
			return { success: true }
		},
	})

	register({
		name: 'ssh_run',
		description: 'Run a foreground SSH command',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: {
			target: { type: 'ssh'; machineId?: string; cwd: string }
			command: string
		}) {
			return runtime.sshExecutor.runCommand(input.target, input.command)
		},
	})

	register({
		name: 'ssh_run_background',
		description: 'Run a background SSH command',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: {
			target: { type: 'ssh'; machineId?: string; cwd: string }
			command: string
		}) {
			return runtime.sshExecutor.runBackgroundCommand(input.target, input.command)
		},
	})

	register({
		name: 'ssh_stream_logs',
		description: 'Stream log tail from a remote run',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: {
			target: { type: 'ssh'; machineId?: string; cwd: string }
			logPath: string
		}) {
			return {
				content: await runtime.sshExecutor.streamLogs(input.target, input.logPath),
			}
		},
	})

	register({
		name: 'ssh_check_status',
		description: 'Check status of a remote background job',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: { target: { type: 'ssh'; machineId?: string; cwd: string }; jobId: string }) {
			return {
				status: await runtime.sshExecutor.checkJobStatus(input.target, input.jobId),
			}
		},
	})

	register({
		name: 'ssh_stop_job',
		description: 'Stop a remote background job',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: { target: { type: 'ssh'; machineId?: string; cwd: string }; jobId: string }) {
			return {
				stopped: await runtime.sshExecutor.stopJob(input.target, input.jobId),
			}
		},
	})

	register({
		name: 'ssh_sync_workspace',
		description: 'Prepare or update the remote working directory',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: {
			target: { type: 'ssh'; machineId?: string; cwd: string }
			mode?: 'mkdir' | 'git_pull'
		}) {
			if (input.mode === 'git_pull') {
				return runtime.sshExecutor.runCommand(input.target, 'git pull --ff-only || true')
			}
			await runtime.sshExecutor.syncWorkspace(input.target)
			return { success: true }
		},
	})

	register({
		name: 'ssh_collect_artifacts',
		description: 'Collect remote artifacts back to the local session store',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: {
			target: { type: 'ssh'; machineId?: string; cwd: string }
			remotePaths: string[]
		}) {
			return {
				paths: await runtime.sshExecutor.collectArtifacts(input.target, input.remotePaths),
			}
		},
	})

	register({
		name: 'ssh_gpu_status',
		description: 'Inspect remote GPU availability',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['remote'],
		async run(input: { target: { type: 'ssh'; machineId?: string; cwd: string } }) {
			return {
				content: await runtime.sshExecutor.gpuStatus(input.target),
			}
		},
	})

	register({
		name: 'research_round_report_writer',
		description: 'Write the fixed-format research round report',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['report'],
		async run(
			input: {
				report: {
					roundId: string
					objective: string
					researchSummary: string[]
					evidenceAdded: string[]
					codeChanges: string[]
					experimentsRun: string[]
					keyResults: string[]
					failuresAndFixes: string[]
					currentBestSoFar: string
					uncertainties: string[]
					nextRoundPlan: string[]
					executionEnvironmentSummary: string[]
				}
			},
			context,
		) {
			const content = formatRoundReport(input.report)
			const path = `reports/${input.report.roundId}.md`
			await context.artifactStore.writeText(path, content)
			await context.artifactStore.writeJson(
				`reports/${input.report.roundId}.json`,
				input.report as unknown as Record<string, unknown>,
			)
			return {
				path: join(context.artifactStore.sessionRoot, path),
				content,
			}
		},
	})

	register({
		name: 'best_so_far_writer',
		description: 'Update the current best-so-far artifact',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['report'],
		async run(
			input: {
				artifact: {
					roundId: string
					summary: string
					branchId?: string
					runId?: string
					supportingEvidenceIds?: string[]
					metrics?: Record<string, number>
					updatedAt: string
				}
			},
			context,
		) {
			const path = 'results/best_so_far_update.json'
			await context.artifactStore.writeJson(
				path,
				input.artifact as unknown as Record<string, unknown>,
			)
			await context.memoryStore.noteBestSoFarUpdate({
				lesson: input.artifact.summary,
			})
			return { path: join(context.artifactStore.sessionRoot, path) }
		},
	})

	register({
		name: 'artifact_aggregator',
		description: 'Aggregate existing research artifacts for summarization',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['summarize'],
		async run(_input: Record<string, never>, context) {
			return aggregateSessionArtifacts(context)
		},
	})

	register({
		name: 'final_summary_writer',
		description: 'Write a concise final summary artifact',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['summarize'],
		async run(input: { title: string; content: string }, context) {
			const path = `summaries/${createResearchId('summary')}.md`
			await context.artifactStore.writeText(path, `# ${input.title}\n\n${input.content}`)
			return {
				path: join(context.artifactStore.sessionRoot, path),
				content: input.content,
			}
		},
	})

	register({
		name: 'final_report_writer',
		description: 'Write a technical final report artifact',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['summarize'],
		async run(input: { title: string; content: string }, context) {
			const path = `summaries/${createResearchId('report')}.md`
			await context.artifactStore.writeText(path, `# ${input.title}\n\n${input.content}`)
			return {
				path: join(context.artifactStore.sessionRoot, path),
				content: input.content,
			}
		},
	})

	register({
		name: 'paper_draft_writer',
		description: 'Write a paper draft only during explicit summarize mode',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['summarize'],
		async run(input: { title: string; content: string }, context) {
			const path = `summaries/${createResearchId('paper')}.md`
			await context.artifactStore.writeText(path, `# ${input.title}\n\n${input.content}`)
			return {
				path: join(context.artifactStore.sessionRoot, path),
				content: input.content,
			}
		},
	})

	register({
		name: 'enter_plan_mode',
		description: 'Switch the research harness into PLAN_MODE',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(_input: Record<string, never>, context) {
			await context.setPermissionMode?.('plan')
			await context.updateSessionState?.((state) => ({
				...state,
				runtimeMode: 'PLAN_MODE',
			}))
			return { success: true }
		},
	})

	register({
		name: 'exit_plan_mode',
		description: 'Switch the research harness out of PLAN_MODE',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(_input: Record<string, never>, context) {
			await context.setPermissionMode?.('default')
			await context.updateSessionState?.((state) => ({
				...state,
				runtimeMode: 'EXECUTION_MODE',
			}))
			return { success: true }
		},
	})

	register({
		name: 'create_task',
		description: 'Create a structured research task',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(input: { task: ResearchTask }, context) {
			return {
				task: await context.taskStore.create(input.task),
			}
		},
	})

	register({
		name: 'update_task',
		description: 'Update a structured research task',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(input: { taskId: string; updates: Partial<ResearchTask> }, context) {
			return {
				task: await context.taskStore.update(input.taskId, input.updates),
			}
		},
	})

	register({
		name: 'list_tasks',
		description: 'List research tasks in the current session',
		isReadOnly: true,
		requiresApproval: false,
		categories: ['orchestration-read'],
		async run(_input: Record<string, never>, context) {
			return {
				tasks: await context.taskStore.list(),
			}
		},
	})

	register({
		name: 'stop_task',
		description: 'Stop a research task',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(input: { taskId: string }, context) {
			return {
				task: await context.taskStore.stop(input.taskId),
			}
		},
	})

	register({
		name: 'spawn_agent',
		description: 'Create an agent-owned research task',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(
			input: {
				title: string
				objective: string
				assignedAgent: string
				branchId?: string
			},
			context,
		) {
			const task: ResearchTask = {
				id: createResearchId('task'),
				type: 'agent_task',
				title: input.title,
				objective: input.objective,
				status: 'pending',
				phase: 'agent_spawn',
				assignedAgent: input.assignedAgent,
				branchId: input.branchId,
				createdAt: nowIso(),
				updatedAt: nowIso(),
				inputs: {},
				outputs: {
					messages: [],
				},
				artifactIds: [],
				nextActionIds: [],
			}
			await context.taskStore.create(task)
			return { task }
		},
	})

	register({
		name: 'send_agent_message',
		description: 'Append a message to an agent task mailbox',
		isReadOnly: false,
		requiresApproval: false,
		categories: ['orchestration-write'],
		async run(input: { taskId: string; message: string }, context) {
			const task = await context.taskStore.get(input.taskId)
			if (!task) {
				throw new Error(`Unknown agent task: ${input.taskId}`)
			}
			const messages = Array.isArray(task.outputs.messages)
				? (task.outputs.messages as string[])
				: []
			const updated = await context.taskStore.update(input.taskId, {
				outputs: {
					...task.outputs,
					messages: [...messages, input.message],
				},
			})
			return { task: updated }
		},
	})
}
