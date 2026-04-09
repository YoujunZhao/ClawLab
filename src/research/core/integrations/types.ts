export type ClawLabIntegrationKind = 'codex' | 'claude_code' | 'openclaw'

export type ClawLabProbeStatus = 'present' | 'missing' | 'configured' | 'unknown'

export type ClawLabIntegrationHealth = 'ready' | 'partial' | 'missing'

export type ClawLabTemplateWriteResult = 'written' | 'skipped'

export type ClawLabProjectTemplate = {
	relativePath: string
	description: string
	content: string
}

export type ClawLabTemplateWriteStat = {
	relativePath: string
	description: string
	result: ClawLabTemplateWriteResult
}

export type ClawLabIntegrationProbe = {
	status: ClawLabProbeStatus
	reason: string
	path?: string
}

export type ClawLabIntegrationReport = {
	kind: ClawLabIntegrationKind
	title: string
	health: ClawLabIntegrationHealth
	cli: ClawLabIntegrationProbe
	userConfig: ClawLabIntegrationProbe
	projectAdapter: ClawLabIntegrationProbe
	auth: ClawLabIntegrationProbe
	notes: string[]
}

export type ClawLabIntegrationInitResult = {
	kind: ClawLabIntegrationKind
	writes: ClawLabTemplateWriteStat[]
}
