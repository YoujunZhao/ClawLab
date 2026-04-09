import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectAllIntegrations, detectIntegration } from '../core/integrations/index.js'
import { extractConcerns } from '../rebuttal/analysis.js'
import { buildRebuttalPlan, normalizeVenue } from '../rebuttal/index.js'
import { readDocumentText } from '../rebuttal/io.js'
import { scanRepoEvidence } from '../rebuttal/repoEvidence.js'
import { getVenuePolicy, validateDraftAgainstPolicy } from '../rebuttal/venuePolicies.js'
import type { ClawLabSkillDefinition, ClawLabSkillId } from './types.js'

export const executableSkills: ClawLabSkillDefinition[] = [
	{
		id: 'integration-doctor',
		name: 'Integration Doctor',
		category: 'integration',
		summary: 'Detect Codex, Claude Code, and OpenClaw installation/config/adapters.',
		usage: [
			'/research skills run integration-doctor',
			'/research skills run integration-doctor codex',
		],
	},
	{
		id: 'review-concern-extract',
		name: 'Review Concern Extract',
		category: 'rebuttal',
		summary: 'Extract structured reviewer concerns from PDF/text reviews.',
		usage: [
			'/research skills run review-concern-extract --review review1.pdf [--review review2.txt]',
		],
	},
	{
		id: 'venue-policy-check',
		name: 'Venue Policy Check',
		category: 'rebuttal',
		summary: 'Validate a rebuttal draft against venue-specific limits and rules.',
		usage: ['/research skills run venue-policy-check --draft rebuttal.md --venue neurips'],
	},
	{
		id: 'repo-evidence-scan',
		name: 'Repo Evidence Scan',
		category: 'evidence',
		summary: 'Scan the local repository for code-backed evidence related to reviewer concerns.',
		usage: ['/research skills run repo-evidence-scan --repo . --review reviews.pdf'],
	},
	{
		id: 'rebuttal-plan',
		name: 'Rebuttal Plan',
		category: 'rebuttal',
		summary: 'Build a venue-aware rebuttal plan with concerns, evidence, and artifacts.',
		usage: [
			'/research skills run rebuttal-plan --paper paper.pdf --review review1.pdf --venue cvpr --repo .',
		],
	},
]

export const curatedExternalSkillReferences = [
	{
		name: 'Paper2Rebuttal',
		url: 'https://github.com/AutoLab-SAI-SJTU/Paper2Rebuttal',
		summary: 'Public rebuttal assistant that ingests manuscript + reviews and drafts a rebuttal.',
	},
	{
		name: 'ClawHub Research Library',
		url: 'https://clawhub.ai/jonbuckles/research-library',
		summary: 'Runnable local-first research library for code, PDFs, OCR, and retrieval.',
	},
	{
		name: 'ClawHub OpenReview Review Analyzer',
		url: 'https://clawhub.ai/skills/openreview-review-analyzer',
		summary: 'Runnable review ingestion helper for OpenReview-based workflows.',
	},
	{
		name: 'ClawHub Code Auditor',
		url: 'https://clawhub.ai/skills/code-auditor',
		summary: 'Runnable repo/code review helper for implementation-backed reviewer questions.',
	},
]

type SkillOptions = {
	reviewPaths: string[]
	paperPath?: string
	repoPath?: string
	venue?: string
	draftPath?: string
}

export function getSkillDefinition(id: string): ClawLabSkillDefinition | undefined {
	return executableSkills.find((skill) => skill.id === id)
}

export function parseSkillOptions(tokens: string[]): SkillOptions {
	const options: SkillOptions = {
		reviewPaths: [],
	}
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		const next = tokens[index + 1]
		if (token === '--review') {
			if (!next) throw new Error('--review requires a path')
			options.reviewPaths.push(next)
			index += 1
			continue
		}
		if (token === '--paper') {
			if (!next) throw new Error('--paper requires a path')
			options.paperPath = next
			index += 1
			continue
		}
		if (token === '--repo') {
			if (!next) throw new Error('--repo requires a path')
			options.repoPath = next
			index += 1
			continue
		}
		if (token === '--venue') {
			if (!next) throw new Error('--venue requires a value')
			options.venue = next
			index += 1
			continue
		}
		if (token === '--draft') {
			if (!next) throw new Error('--draft requires a path')
			options.draftPath = next
			index += 1
			continue
		}
		throw new Error(`Unknown skill option: ${token}`)
	}
	return options
}

async function ensureSkillRunDir(cwd: string): Promise<string> {
	const dir = join(cwd, '.clawlab', 'skills', 'runs')
	await mkdir(dir, { recursive: true })
	return dir
}

async function writeSkillArtifact(cwd: string, name: string, payload: unknown): Promise<string> {
	const runDir = await ensureSkillRunDir(cwd)
	const path = join(runDir, `${Date.now()}-${name}.json`)
	await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
	return path
}

export async function runExecutableSkill(
	cwd: string,
	skillId: ClawLabSkillId,
	tokens: string[],
): Promise<{ summary: string; artifactPath?: string }> {
	if (skillId === 'integration-doctor') {
		const target = tokens[0]
		const result = target
			? [await detectIntegration(target as 'codex' | 'claude_code' | 'openclaw', cwd)]
			: await detectAllIntegrations(cwd)
		const artifactPath = await writeSkillArtifact(cwd, 'integration-doctor', result)
		return {
			summary: `Detected ${result.length} integration profile(s).`,
			artifactPath,
		}
	}

	const options = parseSkillOptions(tokens)

	if (skillId === 'review-concern-extract') {
		if (options.reviewPaths.length === 0) {
			throw new Error('review-concern-extract requires at least one --review path')
		}
		const reviewText = (
			await Promise.all(options.reviewPaths.map((path) => readDocumentText(path)))
		).join('\n\n')
		const concerns = extractConcerns(reviewText)
		const artifactPath = await writeSkillArtifact(cwd, 'review-concern-extract', concerns)
		return {
			summary: `Extracted ${concerns.length} concern(s) from ${options.reviewPaths.length} review file(s).`,
			artifactPath,
		}
	}

	if (skillId === 'venue-policy-check') {
		if (!options.draftPath) {
			throw new Error('venue-policy-check requires --draft <path>')
		}
		const policy = getVenuePolicy(normalizeVenue(options.venue))
		const draft = await readDocumentText(options.draftPath)
		const validation = validateDraftAgainstPolicy(draft, policy)
		const artifactPath = await writeSkillArtifact(cwd, 'venue-policy-check', validation)
		return {
			summary: `Validated draft against ${policy.label}: ${validation.ok ? 'PASS' : 'FAIL'}.`,
			artifactPath,
		}
	}

	if (skillId === 'repo-evidence-scan') {
		if (!options.repoPath) {
			throw new Error('repo-evidence-scan requires --repo <path>')
		}
		if (options.reviewPaths.length === 0) {
			throw new Error('repo-evidence-scan requires at least one --review path')
		}
		const reviewText = (
			await Promise.all(options.reviewPaths.map((path) => readDocumentText(path)))
		).join('\n\n')
		const concerns = extractConcerns(reviewText)
		const evidence = await scanRepoEvidence(options.repoPath, concerns)
		const artifactPath = await writeSkillArtifact(cwd, 'repo-evidence-scan', evidence)
		return {
			summary: `Collected ${evidence.length} repo evidence snippet(s) for ${concerns.length} concern(s).`,
			artifactPath,
		}
	}

	if (!options.paperPath) {
		throw new Error('rebuttal-plan requires --paper <path>')
	}
	if (options.reviewPaths.length === 0) {
		throw new Error('rebuttal-plan requires at least one --review path')
	}
	const { runDir, plan } = await buildRebuttalPlan({
		paperPath: options.paperPath,
		reviewPaths: options.reviewPaths,
		repoPath: options.repoPath,
		venue: normalizeVenue(options.venue),
		outDir: join(cwd, '.clawlab', 'rebuttal', 'runs'),
	})
	return {
		summary: `Built rebuttal plan for ${plan.concerns.length} concern(s) in ${runDir}.`,
		artifactPath: join(runDir, 'rebuttal_plan.json'),
	}
}
