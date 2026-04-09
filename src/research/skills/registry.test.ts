import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { executableSkills, getSkillDefinition, runExecutableSkill } from './registry.js'

let tempRoots: string[] = []

afterEach(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true })
	}
	tempRoots = []
})

function makeTempRoot(): string {
	const root = mkdtempSync(join(os.tmpdir(), 'clawlab-skills-'))
	tempRoots.push(root)
	return root
}

describe('skill registry', () => {
	it('contains only executable local skills', () => {
		expect(executableSkills.length).toBeGreaterThanOrEqual(5)
		expect(getSkillDefinition('integration-doctor')?.name).toContain('Integration')
	})

	it('runs review-concern-extract and writes an artifact', async () => {
		const root = makeTempRoot()
		const reviewPath = join(root, 'review.txt')
		writeFileSync(
			reviewPath,
			'Reviewer 1:\n- The baseline comparison is weak and needs stronger justification.\n',
			'utf8',
		)
		const result = await runExecutableSkill(root, 'review-concern-extract', [
			'--review',
			reviewPath,
		])
		expect(result.summary).toContain('Extracted')
		expect(result.artifactPath).toBeDefined()
	})

	it('runs venue-policy-check on a draft', async () => {
		const root = makeTempRoot()
		const draftPath = join(root, 'draft.md')
		writeFileSync(draftPath, 'Short rebuttal draft.', 'utf8')
		const result = await runExecutableSkill(root, 'venue-policy-check', [
			'--draft',
			draftPath,
			'--venue',
			'generic',
		])
		expect(result.summary).toContain('Validated draft')
	})

	it('runs repo-evidence-scan with a tiny repo', async () => {
		const root = makeTempRoot()
		mkdirSync(join(root, 'src'), { recursive: true })
		writeFileSync(
			join(root, 'src', 'train.py'),
			'sampler_ablation = True\nbaseline_name = "bm25"\n',
			'utf8',
		)
		const reviewPath = join(root, 'review.txt')
		writeFileSync(
			reviewPath,
			'Reviewer 1:\n- The ablation around the sampler is unclear.\n',
			'utf8',
		)
		const result = await runExecutableSkill(root, 'repo-evidence-scan', [
			'--repo',
			root,
			'--review',
			reviewPath,
		])
		expect(result.summary).toContain('Collected')
	})
})
