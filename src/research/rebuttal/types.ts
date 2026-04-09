export type RebuttalVenueId =
	| 'generic'
	| 'cvpr_2025'
	| 'neurips_2025'
	| 'iclr_2026'
	| 'acl_arr_2025'

export type RebuttalLimitKind = 'none' | 'words' | 'characters' | 'pages'

export type RebuttalVenuePolicy = {
	id: RebuttalVenueId
	label: string
	limitKind: RebuttalLimitKind
	limitValue?: number
	format: 'markdown' | 'plain_text' | 'pdf'
	allowsExternalLinks: boolean
	allowsNewExperiments: boolean
	requiresAnonymity: boolean
	notes: string[]
	sourceUrl?: string
}

export type RebuttalConcern = {
	id: string
	reviewerId: string
	summary: string
	detail: string
	quotedText: string
	keywords: string[]
}

export type RebuttalRepoEvidence = {
	id: string
	filePath: string
	lineNumber?: number
	snippet: string
	matchedKeywords: string[]
}

export type RebuttalConcernPlan = {
	concernId: string
	responseGoal: string
	evidenceIds: string[]
	actionItems: string[]
}

export type RebuttalPlanArtifact = {
	createdAt: string
	venue: RebuttalVenuePolicy
	paperPath: string
	reviewPaths: string[]
	repoPath?: string
	concerns: RebuttalConcern[]
	evidence: RebuttalRepoEvidence[]
	plans: RebuttalConcernPlan[]
}

export type RebuttalDraftArtifact = {
	content: string
	usedModel: boolean
	provider: string
	model: string
}

export type RebuttalValidationResult = {
	ok: boolean
	wordCount: number
	characterCount: number
	approxPageCount: number
	issues: string[]
}

export type RebuttalInputBundle = {
	paperPath: string
	reviewPaths: string[]
	repoPath?: string
	venue: RebuttalVenueId
	outDir: string
}
