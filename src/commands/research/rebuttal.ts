import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	buildRebuttalPlan,
	draftRebuttalFromPlan,
	normalizeVenue,
} from '../../research/rebuttal/index.js'
import {
	listVenuePolicies,
	validateDraftAgainstPolicy,
} from '../../research/rebuttal/venuePolicies.js'

type ResearchCommandResult = { type: 'text'; value: string }

type RebuttalOptions = {
	paperPath?: string
	reviewPaths: string[]
	repoPath?: string
	venue?: string
	outDir?: string
	runDir?: string
	draftPath?: string
	force?: boolean
}

function requireValue(tokens: string[], index: number, message: string): string {
	const value = tokens[index + 1]
	if (!value) {
		throw new Error(message)
	}
	return value
}

function parseOptions(tokens: string[]): RebuttalOptions {
	const options: RebuttalOptions = {
		reviewPaths: [],
	}
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		if (token === '--paper') {
			options.paperPath = requireValue(tokens, index, '--paper requires a file path')
			index += 1
			continue
		}
		if (token === '--review') {
			options.reviewPaths.push(requireValue(tokens, index, '--review requires a file path'))
			index += 1
			continue
		}
		if (token === '--repo') {
			options.repoPath = requireValue(tokens, index, '--repo requires a file path')
			index += 1
			continue
		}
		if (token === '--venue') {
			options.venue = requireValue(tokens, index, '--venue requires a venue id')
			index += 1
			continue
		}
		if (token === '--out-dir') {
			options.outDir = requireValue(tokens, index, '--out-dir requires a directory')
			index += 1
			continue
		}
		if (token === '--run-dir') {
			options.runDir = requireValue(tokens, index, '--run-dir requires a directory')
			index += 1
			continue
		}
		if (token === '--draft') {
			options.draftPath = requireValue(tokens, index, '--draft requires a file path')
			index += 1
			continue
		}
		if (token === '--force') {
			options.force = true
			continue
		}
		throw new Error(`Unknown rebuttal option: ${token}`)
	}
	return options
}

async function writeFileIfMissing(
	path: string,
	content: string,
	force = false,
): Promise<'written' | 'skipped'> {
	if (force) {
		await writeFile(path, content, 'utf8')
		return 'written'
	}
	try {
		await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
		return 'written'
	} catch (error) {
		if ((error as { code?: string }).code === 'EEXIST') {
			return 'skipped'
		}
		throw error
	}
}

async function runInit(cwd: string, tokens: string[]): Promise<ResearchCommandResult> {
	const options = parseOptions(tokens)
	const baseDir = join(cwd, '.clawlab', 'rebuttal')
	await mkdir(baseDir, { recursive: true })
	const reads = await Promise.all(
		[
			[
				'REBUTTAL.md',
				[
					'# ClawLab Rebuttal Workflow',
					'',
					'1. Put the paper PDF and review PDFs/text files in this workspace or provide absolute paths.',
					'2. Run `/research rebuttal plan --paper <paper.pdf> --review <review1.pdf> --review <review2.pdf> --venue neurips --repo <repo>`.',
					'3. Run `/research rebuttal draft --run-dir <generated-run-dir>`.',
					'4. Run `/research rebuttal validate --draft <draft.md> --venue neurips`.',
					'',
				].join('\n'),
			],
			[
				'venues.example.json',
				`${JSON.stringify(
					listVenuePolicies().map((policy) => ({
						id: policy.id,
						label: policy.label,
						limitKind: policy.limitKind,
						limitValue: policy.limitValue,
						format: policy.format,
						notes: policy.notes,
						sourceUrl: policy.sourceUrl,
					})),
					null,
					2,
				)}\n`,
			],
		].map(async ([fileName, content]) => ({
			fileName,
			result: await writeFileIfMissing(join(baseDir, fileName), content, options.force),
		})),
	)
	return {
		type: 'text',
		value: [
			`Initialized rebuttal scaffold at ${baseDir}.`,
			...reads.map((item) => `- ${item.fileName}: ${item.result}`),
		].join('\n'),
	}
}

function defaultOutDir(cwd: string): string {
	return join(cwd, '.clawlab', 'rebuttal', 'runs')
}

async function runPlan(cwd: string, tokens: string[]): Promise<ResearchCommandResult> {
	const options = parseOptions(tokens)
	if (!options.paperPath) {
		throw new Error('rebuttal plan requires --paper <path>')
	}
	if (options.reviewPaths.length === 0) {
		throw new Error('rebuttal plan requires at least one --review <path>')
	}
	const { runDir, plan } = await buildRebuttalPlan({
		paperPath: options.paperPath,
		reviewPaths: options.reviewPaths,
		repoPath: options.repoPath,
		venue: normalizeVenue(options.venue),
		outDir: options.outDir ?? defaultOutDir(cwd),
	})
	return {
		type: 'text',
		value: [
			`Planned rebuttal artifacts in ${runDir}.`,
			`Venue: ${plan.venue.label}`,
			`Concerns extracted: ${plan.concerns.length}`,
			`Repo evidence snippets: ${plan.evidence.length}`,
			'Artifacts:',
			`- ${join(runDir, 'paper.txt')}`,
			`- ${join(runDir, 'reviews.txt')}`,
			`- ${join(runDir, 'concerns.json')}`,
			`- ${join(runDir, 'repo_evidence.json')}`,
			`- ${join(runDir, 'rebuttal_plan.md')}`,
		].join('\n'),
	}
}

async function runDraft(_cwd: string, tokens: string[]): Promise<ResearchCommandResult> {
	const options = parseOptions(tokens)
	if (!options.runDir) {
		throw new Error('rebuttal draft requires --run-dir <path>')
	}
	const planPath = join(options.runDir, 'rebuttal_plan.json')
	const plan = JSON.parse(await readFile(planPath, 'utf8'))
	const result = await draftRebuttalFromPlan(options.runDir, plan)
	return {
		type: 'text',
		value: [
			`Drafted rebuttal in ${result.draftPath}.`,
			`Validation artifact: ${result.validationPath}`,
			`Draft source: ${result.usedModel ? `${result.provider} (${result.model})` : 'deterministic template fallback'}`,
		].join('\n'),
	}
}

async function runValidate(_cwd: string, tokens: string[]): Promise<ResearchCommandResult> {
	const options = parseOptions(tokens)
	if (!options.draftPath) {
		throw new Error('rebuttal validate requires --draft <path>')
	}
	const policy = listVenuePolicies().find((item) => item.id === normalizeVenue(options.venue))
	const draft = await readFile(options.draftPath, 'utf8')
	const validation = validateDraftAgainstPolicy(draft, policy ?? listVenuePolicies()[0])
	return {
		type: 'text',
		value: [
			`Validation: ${validation.ok ? 'PASS' : 'FAIL'}`,
			`Words: ${validation.wordCount}`,
			`Characters: ${validation.characterCount}`,
			`Approx pages: ${validation.approxPageCount}`,
			...(validation.issues.length > 0
				? ['Issues:', ...validation.issues.map((issue) => `- ${issue}`)]
				: ['Issues: none']),
		].join('\n'),
	}
}

function runHelp(): ResearchCommandResult {
	return {
		type: 'text',
		value: [
			'Research rebuttal commands:',
			'- /research rebuttal init [--force]',
			'- /research rebuttal plan --paper <paper.pdf> --review <review.pdf|txt> [--review ...] [--repo <repo>] [--venue <cvpr|neurips|iclr|acl_arr>] [--out-dir <dir>]',
			'- /research rebuttal draft --run-dir <dir>',
			'- /research rebuttal validate --draft <draft.md> [--venue <cvpr|neurips|iclr|acl_arr>]',
		].join('\n'),
	}
}

export async function runRebuttalCommand(
	cwd: string,
	tail: string[],
): Promise<ResearchCommandResult> {
	const subcommand = tail[0] ?? 'help'
	const tokens = tail.slice(1)
	if (subcommand === 'init') {
		return runInit(cwd, tokens)
	}
	if (subcommand === 'plan') {
		return runPlan(cwd, tokens)
	}
	if (subcommand === 'draft') {
		return runDraft(cwd, tokens)
	}
	if (subcommand === 'validate') {
		return runValidate(cwd, tokens)
	}
	if (subcommand === 'help') {
		return runHelp()
	}
	throw new Error(
		`research rebuttal subcommand not recognized: ${subcommand}. Run /research rebuttal help.`,
	)
}
