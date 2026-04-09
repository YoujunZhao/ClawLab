import { createResearchId } from '../core/ids.js'
import { buildConcernPlans, extractConcerns } from './analysis.js'
import {
	ensureRebuttalRunDir,
	persistInputBundle,
	persistJsonArtifact,
	persistTextArtifact,
	readDocumentText,
} from './io.js'
import { scanRepoEvidence } from './repoEvidence.js'
import type { RebuttalInputBundle, RebuttalPlanArtifact, RebuttalVenueId } from './types.js'
import { getVenuePolicy } from './venuePolicies.js'

export async function buildRebuttalPlan(input: RebuttalInputBundle): Promise<{
	runDir: string
	plan: RebuttalPlanArtifact
}> {
	const runDir = await ensureRebuttalRunDir(input.outDir)
	await persistInputBundle(runDir, input)
	const paperText = await readDocumentText(input.paperPath)
	const reviewTexts = await Promise.all(input.reviewPaths.map((path) => readDocumentText(path)))
	const reviewText = reviewTexts.join('\n\n')
	const venue = getVenuePolicy(input.venue)
	const concerns = extractConcerns(reviewText)
	const evidence = await scanRepoEvidence(input.repoPath, concerns)
	const plans = buildConcernPlans(concerns, evidence)
	const artifact: RebuttalPlanArtifact = {
		createdAt: new Date().toISOString(),
		venue,
		paperPath: input.paperPath,
		reviewPaths: input.reviewPaths,
		repoPath: input.repoPath,
		concerns,
		evidence,
		plans,
	}
	await persistTextArtifact(runDir, 'paper.txt', paperText)
	await persistTextArtifact(runDir, 'reviews.txt', reviewText)
	await persistJsonArtifact(runDir, 'venue_policy.json', venue)
	await persistJsonArtifact(runDir, 'concerns.json', concerns)
	await persistJsonArtifact(runDir, 'repo_evidence.json', evidence)
	await persistJsonArtifact(runDir, 'rebuttal_plan.json', artifact)
	const planMarkdown = [
		`# Rebuttal Plan ${createResearchId('plan')}`,
		'',
		`- Venue: ${venue.label}`,
		`- Paper: ${input.paperPath}`,
		`- Reviews: ${input.reviewPaths.join(', ')}`,
		`- Repo: ${input.repoPath ?? 'not provided'}`,
		'',
		'## Concerns',
		...concerns.map((concern) => `- [${concern.reviewerId}] ${concern.detail}`),
		'',
		'## Evidence',
		...(evidence.length > 0
			? evidence.map(
					(item) =>
						`- ${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ''}: ${item.snippet}`,
				)
			: ['- No strong repo evidence matched yet.']),
	].join('\n')
	await persistTextArtifact(runDir, 'rebuttal_plan.md', planMarkdown)
	return {
		runDir,
		plan: artifact,
	}
}

export async function draftRebuttalFromPlan(
	runDir: string,
	plan: RebuttalPlanArtifact,
): Promise<{
	draftPath: string
	validationPath: string
	usedModel: boolean
	provider: string
	model: string
}> {
	const { generateRebuttalDraft, validateRebuttalDraft } = await import('./draft.js')
	const draft = await generateRebuttalDraft(plan)
	const validation = validateRebuttalDraft(plan, draft)
	const draftPath = await persistTextArtifact(runDir, 'rebuttal_draft.md', draft.content)
	const validationPath = await persistJsonArtifact(runDir, 'rebuttal_validation.json', validation)
	return {
		draftPath,
		validationPath,
		usedModel: draft.usedModel,
		provider: draft.provider,
		model: draft.model,
	}
}

export function normalizeVenue(value: string | undefined): RebuttalVenueId {
	if (!value) {
		return 'generic'
	}
	const normalized = value.toLowerCase().replace(/[-\s]/gu, '_')
	if (normalized === 'cvpr' || normalized === 'cvpr_2025') {
		return 'cvpr_2025'
	}
	if (normalized === 'neurips' || normalized === 'neurips_2025') {
		return 'neurips_2025'
	}
	if (normalized === 'iclr' || normalized === 'iclr_2026') {
		return 'iclr_2026'
	}
	if (
		normalized === 'acl_arr' ||
		normalized === 'acl_arr_2025' ||
		normalized === 'arr' ||
		normalized === 'acl'
	) {
		return 'acl_arr_2025'
	}
	return 'generic'
}
