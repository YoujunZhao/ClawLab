import type { RebuttalValidationResult, RebuttalVenueId, RebuttalVenuePolicy } from './types.js'

const PAGE_CHARACTER_BUDGET = 3000

const venuePolicies: Record<RebuttalVenueId, RebuttalVenuePolicy> = {
	generic: {
		id: 'generic',
		label: 'Generic Rebuttal',
		limitKind: 'none',
		format: 'markdown',
		allowsExternalLinks: false,
		allowsNewExperiments: false,
		requiresAnonymity: true,
		notes: [
			'Keep claims evidence-grounded and concise.',
			'Avoid promising experiments or artifacts that do not exist yet.',
		],
	},
	cvpr_2025: {
		id: 'cvpr_2025',
		label: 'CVPR 2025 Rebuttal',
		limitKind: 'pages',
		limitValue: 1,
		format: 'pdf',
		allowsExternalLinks: false,
		allowsNewExperiments: false,
		requiresAnonymity: true,
		notes: [
			'Use the official one-page rebuttal template.',
			'Do not add links to code, videos, or external material in the rebuttal.',
			'Only include new experiments if reviewers explicitly requested them and the venue permits it.',
		],
		sourceUrl: 'https://cvpr.thecvf.com/Conferences/2025/AuthorGuidelines',
	},
	neurips_2025: {
		id: 'neurips_2025',
		label: 'NeurIPS 2025 Author Response',
		limitKind: 'characters',
		limitValue: 10_000,
		format: 'plain_text',
		allowsExternalLinks: false,
		allowsNewExperiments: false,
		requiresAnonymity: true,
		notes: [
			'Keep each review response under 10,000 characters.',
			'Use plain text with Markdown support only.',
			'Do not rely on extra file uploads for the rebuttal itself.',
		],
		sourceUrl: 'https://nips.cc/Conferences/2025/PaperInformation/NeurIPS-FAQ',
	},
	iclr_2026: {
		id: 'iclr_2026',
		label: 'ICLR 2026 Discussion / Rebuttal',
		limitKind: 'words',
		limitValue: 1200,
		format: 'markdown',
		allowsExternalLinks: false,
		allowsNewExperiments: true,
		requiresAnonymity: true,
		notes: [
			'ICLR author comments have word limits per comment in discussion.',
			'The paper may be revised during rebuttal/discussion.',
			'Prefer splitting long responses into multiple concise reviewer-targeted comments.',
		],
		sourceUrl: 'https://iclr.cc/Conferences/2026/AuthorGuide',
	},
	acl_arr_2025: {
		id: 'acl_arr_2025',
		label: 'ACL ARR In-Cycle Author Response',
		limitKind: 'words',
		limitValue: 900,
		format: 'markdown',
		allowsExternalLinks: false,
		allowsNewExperiments: false,
		requiresAnonymity: true,
		notes: [
			'Focus on clear factual errors or serious misunderstandings.',
			'Keep the tone corrective and evidence-grounded, not promotional.',
			'When in doubt, prioritize revision guidance over broad new claims.',
		],
		sourceUrl: 'https://aclrollingreview.org/in-cycle-author-response/',
	},
}

export function getVenuePolicy(venue: RebuttalVenueId): RebuttalVenuePolicy {
	return venuePolicies[venue] ?? venuePolicies.generic
}

export function listVenuePolicies(): RebuttalVenuePolicy[] {
	return Object.values(venuePolicies)
}

function countWords(text: string): number {
	return text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length
}

export function validateDraftAgainstPolicy(
	content: string,
	policy: RebuttalVenuePolicy,
): RebuttalValidationResult {
	const characterCount = content.length
	const wordCount = countWords(content)
	const approxPageCount = Math.max(1, Math.ceil(characterCount / PAGE_CHARACTER_BUDGET))
	const issues: string[] = []
	if (
		policy.limitKind === 'characters' &&
		policy.limitValue &&
		characterCount > policy.limitValue
	) {
		issues.push(
			`Character count ${characterCount} exceeds the ${policy.limitValue} limit for ${policy.label}.`,
		)
	}
	if (policy.limitKind === 'words' && policy.limitValue && wordCount > policy.limitValue) {
		issues.push(
			`Word count ${wordCount} exceeds the ${policy.limitValue} limit for ${policy.label}.`,
		)
	}
	if (policy.limitKind === 'pages' && policy.limitValue && approxPageCount > policy.limitValue) {
		issues.push(
			`Approximate page count ${approxPageCount} exceeds the ${policy.limitValue}-page limit for ${policy.label}.`,
		)
	}
	if (!policy.allowsExternalLinks && /https?:\/\//u.test(content)) {
		issues.push(`${policy.label} does not allow external links in the rebuttal body.`)
	}
	return {
		ok: issues.length === 0,
		wordCount,
		characterCount,
		approxPageCount,
		issues,
	}
}
