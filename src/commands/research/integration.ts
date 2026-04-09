import {
	type ClawLabIntegrationKind,
	type ClawLabIntegrationReport,
	detectAllIntegrations,
	detectIntegration,
	initializeIntegration,
} from '../../research/core/integrations/index.js'

type ResearchCommandResult = { type: 'text'; value: string }

function normalizeKind(value: string): ClawLabIntegrationKind {
	if (value === 'codex') {
		return 'codex'
	}
	if (value === 'claude' || value === 'claude-code' || value === 'claude_code') {
		return 'claude_code'
	}
	if (value === 'openclaw') {
		return 'openclaw'
	}
	throw new Error(`Unknown integration target: ${value}. Expected codex, claude-code, or openclaw.`)
}

function parseInitOptions(tokens: string[]): {
	kind: ClawLabIntegrationKind | 'all'
	force: boolean
} {
	let force = false
	let kind: ClawLabIntegrationKind | 'all' = 'all'
	for (const token of tokens) {
		if (token === '--force') {
			force = true
			continue
		}
		kind = token === 'all' ? 'all' : normalizeKind(token)
	}
	return { kind, force }
}

function formatProbe(
	label: string,
	probe: ClawLabIntegrationReport[keyof Pick<
		ClawLabIntegrationReport,
		'cli' | 'userConfig' | 'projectAdapter' | 'auth'
	>],
): string[] {
	const suffix = probe.path ? ` (${probe.path})` : ''
	return [`- ${label}: ${probe.status}${suffix}`, `  ${probe.reason}`]
}

function formatReport(report: ClawLabIntegrationReport): string {
	const lines = [`${report.title}: ${report.health}`]
	lines.push(...formatProbe('CLI', report.cli))
	lines.push(...formatProbe('User config', report.userConfig))
	lines.push(...formatProbe('Project adapter', report.projectAdapter))
	lines.push(...formatProbe('Auth', report.auth))
	if (report.notes.length > 0) {
		lines.push('- Notes:')
		for (const note of report.notes) {
			lines.push(`  - ${note}`)
		}
	}
	return lines.join('\n')
}

async function runStatus(cwd: string): Promise<ResearchCommandResult> {
	const reports = await detectAllIntegrations(cwd)
	return {
		type: 'text',
		value: reports.map((report) => formatReport(report)).join('\n\n'),
	}
}

async function runDoctor(cwd: string, tokens: string[]): Promise<ResearchCommandResult> {
	const kind = tokens[0] ? normalizeKind(tokens[0]) : undefined
	const reports = kind ? [await detectIntegration(kind, cwd)] : await detectAllIntegrations(cwd)
	const lines = ['ClawLab native integration doctor', '']
	for (const report of reports) {
		lines.push(formatReport(report))
		lines.push('')
		const recommendedActions = []
		if (report.cli.status === 'missing') {
			recommendedActions.push(`install ${report.title} CLI or add it to PATH`)
		}
		if (report.userConfig.status === 'missing') {
			recommendedActions.push(
				`create a user-level ${report.title} config before expecting auto-discovery`,
			)
		}
		if (report.projectAdapter.status === 'missing') {
			recommendedActions.push(`run /research integration init ${report.kind}`)
		}
		if (report.auth.status === 'missing') {
			recommendedActions.push(`configure credentials for ${report.title}`)
		}
		if (report.auth.status === 'unknown') {
			recommendedActions.push(
				`validate ${report.title} login manually because static detection cannot prove it`,
			)
		}
		if (recommendedActions.length > 0) {
			lines.push('Recommended actions:')
			for (const action of recommendedActions) {
				lines.push(`- ${action}`)
			}
			lines.push('')
		}
	}
	return {
		type: 'text',
		value: lines.join('\n').trim(),
	}
}

async function runInit(cwd: string, tokens: string[]): Promise<ResearchCommandResult> {
	const { kind, force } = parseInitOptions(tokens)
	const kinds: ClawLabIntegrationKind[] =
		kind === 'all' ? ['codex', 'claude_code', 'openclaw'] : [kind]
	const results = []
	for (const item of kinds) {
		results.push(await initializeIntegration(item, cwd, force))
	}
	const lines = [`Initialized native integration templates at ${cwd}.`, '']
	for (const result of results) {
		lines.push(`${result.kind}:`)
		for (const write of result.writes) {
			lines.push(`- ${write.relativePath} -> ${write.result} (${write.description})`)
		}
		lines.push('')
	}
	if (force) {
		lines.push('Overwrite mode: enabled (--force)')
	}
	return {
		type: 'text',
		value: lines.join('\n').trim(),
	}
}

function runHelp(): ResearchCommandResult {
	return {
		type: 'text',
		value: [
			'Research integration commands:',
			'- /research integration status',
			'- /research integration doctor [codex|claude-code|openclaw]',
			'- /research integration init [all|codex|claude-code|openclaw] [--force]',
		].join('\n'),
	}
}

export async function runIntegrationCommand(
	cwd: string,
	tail: string[],
): Promise<ResearchCommandResult> {
	const subcommand = tail[0] ?? 'status'
	const tokens = tail.slice(1)
	if (subcommand === 'status') {
		return runStatus(cwd)
	}
	if (subcommand === 'doctor') {
		return runDoctor(cwd, tokens)
	}
	if (subcommand === 'init') {
		return runInit(cwd, tokens)
	}
	if (subcommand === 'help') {
		return runHelp()
	}
	throw new Error(
		`research integration subcommand not recognized: ${subcommand}. Run /research integration help.`,
	)
}
