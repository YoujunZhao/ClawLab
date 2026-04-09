import {
	curatedExternalSkillReferences,
	executableSkills,
	getSkillDefinition,
	runExecutableSkill,
} from '../../research/skills/registry.js'

type ResearchCommandResult = { type: 'text'; value: string }

function runList(): ResearchCommandResult {
	const lines = ['Executable ClawLab skills:']
	for (const skill of executableSkills) {
		lines.push(`- ${skill.id} [${skill.category}] ${skill.name}: ${skill.summary}`)
	}
	lines.push('', 'Curated external references:')
	for (const reference of curatedExternalSkillReferences) {
		lines.push(`- ${reference.name}: ${reference.summary} (${reference.url})`)
	}
	return {
		type: 'text',
		value: lines.join('\n'),
	}
}

function runShow(skillId: string): ResearchCommandResult {
	const skill = getSkillDefinition(skillId)
	if (!skill) {
		throw new Error(`Unknown skill: ${skillId}`)
	}
	return {
		type: 'text',
		value: [
			`${skill.name} (${skill.id})`,
			`Category: ${skill.category}`,
			`Summary: ${skill.summary}`,
			'Usage:',
			...skill.usage.map((line) => `- ${line}`),
		].join('\n'),
	}
}

async function runSkill(
	cwd: string,
	skillId: string,
	tokens: string[],
): Promise<ResearchCommandResult> {
	const skill = getSkillDefinition(skillId)
	if (!skill) {
		throw new Error(`Unknown skill: ${skillId}`)
	}
	const result = await runExecutableSkill(cwd, skill.id, tokens)
	return {
		type: 'text',
		value: [
			`Ran skill ${skill.id}.`,
			result.summary,
			...(result.artifactPath ? [`Artifact: ${result.artifactPath}`] : []),
		].join('\n'),
	}
}

function runHelp(): ResearchCommandResult {
	return {
		type: 'text',
		value: [
			'Research skills commands:',
			'- /research skills list',
			'- /research skills show <skill-id>',
			'- /research skills run <skill-id> [skill options]',
		].join('\n'),
	}
}

export async function runSkillsCommand(
	cwd: string,
	tail: string[],
): Promise<ResearchCommandResult> {
	const subcommand = tail[0] ?? 'list'
	const tokens = tail.slice(1)
	if (subcommand === 'list') {
		return runList()
	}
	if (subcommand === 'show') {
		const skillId = tokens[0]
		if (!skillId) {
			throw new Error('research skills show requires a skill id')
		}
		return runShow(skillId)
	}
	if (subcommand === 'run') {
		const skillId = tokens[0]
		if (!skillId) {
			throw new Error('research skills run requires a skill id')
		}
		return runSkill(cwd, skillId, tokens.slice(1))
	}
	if (subcommand === 'help') {
		return runHelp()
	}
	throw new Error(
		`research skills subcommand not recognized: ${subcommand}. Run /research skills help.`,
	)
}
