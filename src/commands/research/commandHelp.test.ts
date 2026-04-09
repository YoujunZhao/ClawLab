import { describe, expect, it } from 'bun:test'
import { runIntegrationCommand } from './integration.js'
import { runRebuttalCommand } from './rebuttal.js'
import { runSkillsCommand } from './skills.js'

describe('research command surfaces', () => {
	it('returns integration help', async () => {
		const result = await runIntegrationCommand(process.cwd(), ['help'])
		expect(result.value).toContain('/research integration status')
	})

	it('returns rebuttal help', async () => {
		const result = await runRebuttalCommand(process.cwd(), ['help'])
		expect(result.value).toContain('/research rebuttal plan')
	})

	it('returns skills list', async () => {
		const result = await runSkillsCommand(process.cwd(), ['list'])
		expect(result.value).toContain('Executable ClawLab skills')
		expect(result.value).toContain('integration-doctor')
	})
})
