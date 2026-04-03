import type { Command } from '../../commands.js'

const research = {
	type: 'local',
	name: 'research',
	description:
		'Run the ClawLab Auto Research Loop for new topics or existing-project improvement, with local/SSH execution and configurable model backends',
	supportsNonInteractive: true,
	load: () => import('./research.js'),
} satisfies Command

export default research
