import { createModelRouter } from '../core/model-router/modelRouter.js'
import type {
	RebuttalDraftArtifact,
	RebuttalPlanArtifact,
	RebuttalValidationResult,
} from './types.js'
import { validateDraftAgainstPolicy } from './venuePolicies.js'

function buildEvidenceSummary(plan: RebuttalPlanArtifact): string {
	if (plan.evidence.length === 0) {
		return 'No repo-backed evidence snippets were matched yet.'
	}
	return plan.evidence
		.slice(0, 10)
		.map(
			(item) =>
				`- ${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ''}: ${item.snippet}`,
		)
		.join('\n')
}

function buildDeterministicDraft(plan: RebuttalPlanArtifact): string {
	const sections = [
		`# ${plan.venue.label} Rebuttal Draft`,
		'',
		'## Venue Constraints',
		...plan.venue.notes.map((note) => `- ${note}`),
		'',
		'## Response Strategy',
		'- Start each response with a direct answer to the reviewer concern.',
		'- Use only evidence that is already present in the paper, repo, or validated artifacts.',
		'- Narrow claims whenever evidence is incomplete.',
		'',
	]
	for (const concern of plan.concerns) {
		const concernPlan = plan.plans.find((item) => item.concernId === concern.id)
		const evidenceLines = plan.evidence
			.filter((item) => concernPlan?.evidenceIds.includes(item.id))
			.map(
				(item) =>
					`- Evidence: ${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ''} -> ${item.snippet}`,
			)
		sections.push(`## ${concern.reviewerId}: ${concern.summary}`)
		sections.push(`Concern: ${concern.detail}`)
		sections.push(`Response goal: ${concernPlan?.responseGoal ?? 'Answer directly and carefully.'}`)
		if (evidenceLines.length > 0) {
			sections.push(...evidenceLines)
		} else {
			sections.push('- Evidence: No strong local evidence match yet; respond conservatively.')
		}
		sections.push(
			'Draft response: Thank you for the careful feedback. We will respond directly to this concern, clarify the relevant part of the method and evaluation, and avoid overstating what is currently supported by evidence.',
		)
		sections.push('')
	}
	return sections.join('\n')
}

async function tryModelDraft(plan: RebuttalPlanArtifact): Promise<RebuttalDraftArtifact | null> {
	const router = createModelRouter()
	const summary = router.describe()
	if (summary.status !== 'ready') {
		return null
	}
	const prompt = [
		`Write a concise ${plan.venue.label} rebuttal draft.`,
		`Venue format: ${plan.venue.format}`,
		`Limit kind: ${plan.venue.limitKind}${plan.venue.limitValue ? `=${plan.venue.limitValue}` : ''}`,
		`Allows external links: ${plan.venue.allowsExternalLinks}`,
		`Allows new experiments: ${plan.venue.allowsNewExperiments}`,
		`Requires anonymity: ${plan.venue.requiresAnonymity}`,
		'Venue notes:',
		...plan.venue.notes.map((note) => `- ${note}`),
		'',
		'Concerns:',
		...plan.concerns.map((concern) => `- [${concern.reviewerId}] ${concern.detail}`),
		'',
		'Repo evidence:',
		buildEvidenceSummary(plan),
		'',
		'Requirements:',
		'- respond point-by-point',
		'- do not invent experiments, results, or implementation details',
		'- explicitly acknowledge uncertainty when evidence is weak',
		'- keep the output within venue limits as closely as possible',
	].join('\n')
	try {
		const response = await router.route('summary', prompt)
		if (!response.content.trim()) {
			return null
		}
		return {
			content: response.content.trim(),
			usedModel: true,
			provider: response.provider,
			model: response.model,
		}
	} catch {
		return null
	}
}

export async function generateRebuttalDraft(
	plan: RebuttalPlanArtifact,
): Promise<RebuttalDraftArtifact> {
	const modelDraft = await tryModelDraft(plan)
	if (modelDraft) {
		return modelDraft
	}
	return {
		content: buildDeterministicDraft(plan),
		usedModel: false,
		provider: 'template',
		model: 'deterministic',
	}
}

export function validateRebuttalDraft(
	plan: RebuttalPlanArtifact,
	draft: RebuttalDraftArtifact,
): RebuttalValidationResult {
	return validateDraftAgainstPolicy(draft.content, plan.venue)
}
