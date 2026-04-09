import { createResearchId } from '../core/ids.js'
import type { RebuttalConcern, RebuttalConcernPlan, RebuttalRepoEvidence } from './types.js'

const STOP_WORDS = new Set([
	'the',
	'this',
	'that',
	'with',
	'from',
	'have',
	'into',
	'their',
	'they',
	'were',
	'what',
	'when',
	'which',
	'while',
	'where',
	'about',
	'because',
	'should',
	'could',
	'would',
	'there',
	'these',
	'those',
	'using',
	'used',
	'also',
	'than',
	'your',
	'paper',
	'authors',
	'author',
	'please',
])

function uniqueKeywords(text: string): string[] {
	return Array.from(
		new Set(
			text
				.toLowerCase()
				.match(/[a-z][a-z0-9_-]{3,}/gu)
				?.filter((token) => !STOP_WORDS.has(token)) ?? [],
		),
	).slice(0, 8)
}

function normalizeLines(text: string): string[] {
	return text
		.replace(/\r\n/gu, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}

type ReviewerSection = {
	reviewerId: string
	body: string
}

export function splitReviewerSections(text: string): ReviewerSection[] {
	const lines = normalizeLines(text)
	const sections: ReviewerSection[] = []
	let currentReviewer = 'general'
	let currentLines: string[] = []
	for (const line of lines) {
		if (/^(reviewer|review|r)\s*[-:#]?\s*\d+/iu.test(line)) {
			if (currentLines.length > 0) {
				sections.push({
					reviewerId: currentReviewer,
					body: currentLines.join('\n'),
				})
			}
			currentReviewer = line.replace(/[:#-]\s*$/u, '')
			currentLines = []
			continue
		}
		currentLines.push(line)
	}
	if (currentLines.length > 0) {
		sections.push({
			reviewerId: currentReviewer,
			body: currentLines.join('\n'),
		})
	}
	return sections.length > 0 ? sections : [{ reviewerId: 'general', body: text }]
}

function splitConcernCandidates(sectionBody: string): string[] {
	const bulletMatches = sectionBody
		.split(/\n+/u)
		.map((line) => line.trim())
		.filter((line) => /^[-*]|\d+[.)]/u.test(line) && line.length > 20)
	if (bulletMatches.length > 0) {
		return bulletMatches
	}
	const paragraphMatches = sectionBody
		.split(/\n{2,}/u)
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.length > 40)
	if (paragraphMatches.length > 0) {
		return paragraphMatches
	}
	return sectionBody
		.split(/(?<=[.?!])\s+/u)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 40)
}

export function extractConcerns(reviewText: string): RebuttalConcern[] {
	const concerns: RebuttalConcern[] = []
	for (const section of splitReviewerSections(reviewText)) {
		for (const candidate of splitConcernCandidates(section.body)) {
			const clean = candidate.replace(/^[-*\d.)\s]+/u, '').trim()
			if (clean.length < 30) {
				continue
			}
			concerns.push({
				id: createResearchId('concern'),
				reviewerId: section.reviewerId,
				summary: clean.slice(0, 140),
				detail: clean,
				quotedText: clean,
				keywords: uniqueKeywords(clean),
			})
		}
	}
	return concerns
}

function responseGoalForConcern(detail: string): string {
	const lower = detail.toLowerCase()
	if (lower.includes('ablation')) {
		return 'Clarify the ablation rationale and point to component-level evidence.'
	}
	if (lower.includes('baseline') || lower.includes('compare')) {
		return 'Explain the baseline choice and defend comparison fairness with concrete evidence.'
	}
	if (lower.includes('reproduc') || lower.includes('code')) {
		return 'Ground the response in implementation details, release status, and reproducibility evidence.'
	}
	if (lower.includes('novel') || lower.includes('incremental')) {
		return 'Clarify novelty relative to prior work and narrow the contribution claim if needed.'
	}
	if (lower.includes('theory') || lower.includes('proof')) {
		return 'Address the theoretical gap directly and avoid overstating guarantees.'
	}
	return 'Respond directly, acknowledge any real limitation, and tie the answer to concrete evidence.'
}

export function buildConcernPlans(
	concerns: RebuttalConcern[],
	evidence: RebuttalRepoEvidence[],
): RebuttalConcernPlan[] {
	return concerns.map((concern) => {
		const evidenceIds = evidence
			.filter((item) => item.matchedKeywords.some((keyword) => concern.keywords.includes(keyword)))
			.slice(0, 4)
			.map((item) => item.id)
		return {
			concernId: concern.id,
			responseGoal: responseGoalForConcern(concern.detail),
			evidenceIds,
			actionItems: [
				'Answer the reviewer concern directly in the first sentence.',
				evidenceIds.length > 0
					? 'Point to repo or manuscript evidence before making any promise.'
					: 'State the limitation clearly if supporting evidence is not yet available.',
				'Keep the response aligned with venue constraints.',
			],
		}
	})
}
