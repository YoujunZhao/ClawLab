import { describe, expect, it } from 'bun:test'
import { extractConcerns, splitReviewerSections } from './analysis.js'
import { getVenuePolicy, validateDraftAgainstPolicy } from './venuePolicies.js'

describe('rebuttal concern extraction', () => {
	it('splits reviewer sections and extracts concerns', () => {
		const review = [
			'Reviewer 1:',
			'- The ablation study is incomplete and does not isolate the sampler effect.',
			'- Baseline comparisons are not convincing for the retrieval benchmark.',
			'',
			'Reviewer 2:',
			'The code release and reproducibility story are unclear.',
		].join('\n')
		const sections = splitReviewerSections(review)
		const concerns = extractConcerns(review)
		expect(sections.length).toBe(2)
		expect(concerns.length).toBeGreaterThanOrEqual(3)
		expect(concerns.some((item) => item.keywords.includes('ablation'))).toBe(true)
	})
})

describe('venue policy validation', () => {
	it('fails drafts that exceed NeurIPS character limits', () => {
		const policy = getVenuePolicy('neurips_2025')
		const validation = validateDraftAgainstPolicy('a'.repeat(10_500), policy)
		expect(validation.ok).toBe(false)
		expect(validation.issues.length).toBeGreaterThan(0)
	})

	it('accepts small generic drafts', () => {
		const policy = getVenuePolicy('generic')
		const validation = validateDraftAgainstPolicy('Short response.', policy)
		expect(validation.ok).toBe(true)
	})
})
