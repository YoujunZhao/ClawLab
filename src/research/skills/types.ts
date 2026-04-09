export type ClawLabSkillId =
	| 'integration-doctor'
	| 'review-concern-extract'
	| 'venue-policy-check'
	| 'repo-evidence-scan'
	| 'rebuttal-plan'

export type ClawLabSkillDefinition = {
	id: ClawLabSkillId
	name: string
	category: 'integration' | 'rebuttal' | 'evidence'
	summary: string
	usage: string[]
}
