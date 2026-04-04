import type { Command } from '../../commands.js'

const research = {
	type: 'local',
	name: 'research',
	description:
		'Run the ClawLab Auto Research Loop with stage scaffolding, Team multi-agent mode, built-in research skills, and local/SSH execution',
	supportsNonInteractive: true,
	load: () => import('./research.js'),
} satisfies Command

export default research
