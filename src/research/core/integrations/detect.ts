import { accessSync, existsSync, constants as fsConstants } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { getIntegrationTemplates } from './templates.js'
import type {
	ClawLabIntegrationHealth,
	ClawLabIntegrationInitResult,
	ClawLabIntegrationKind,
	ClawLabIntegrationProbe,
	ClawLabIntegrationReport,
	ClawLabTemplateWriteResult,
} from './types.js'

function resolveCodexHome(): string {
	return process.env.CODEX_HOME ?? join(os.homedir(), '.codex')
}

function resolveClaudeHome(): string {
	return process.env.CLAUDE_CONFIG_DIR ?? join(os.homedir(), '.claude')
}

function resolveOpenClawHome(): string {
	return process.env.OPENCLAW_HOME ?? join(os.homedir(), '.openclaw')
}

function splitPathEntries(envPath = process.env.PATH ?? ''): string[] {
	return envPath
		.split(delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

function candidateExecutableNames(command: string): string[] {
	if (process.platform !== 'win32') {
		return [command]
	}
	const pathExts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
		.split(';')
		.map((value) => value.toLowerCase())
	const lower = command.toLowerCase()
	const hasExtension = pathExts.some((ext) => lower.endsWith(ext))
	if (hasExtension) {
		return [command]
	}
	return [command, ...pathExts.map((ext) => `${command}${ext.toLowerCase()}`)]
}

export function findExecutable(
	command: string,
	envPath = process.env.PATH ?? '',
): string | undefined {
	for (const directory of splitPathEntries(envPath)) {
		for (const candidate of candidateExecutableNames(command)) {
			const fullPath = join(directory, candidate)
			if (!existsSync(fullPath)) {
				continue
			}
			try {
				if (process.platform === 'win32') {
					return fullPath
				}
				accessSync(fullPath, fsConstants.X_OK)
				return fullPath
			} catch {}
		}
	}
	return undefined
}

function presentProbe(path: string, reason: string): ClawLabIntegrationProbe {
	return {
		status: 'present',
		path,
		reason,
	}
}

function missingProbe(reason: string): ClawLabIntegrationProbe {
	return {
		status: 'missing',
		reason,
	}
}

function configuredProbe(path: string, reason: string): ClawLabIntegrationProbe {
	return {
		status: 'configured',
		path,
		reason,
	}
}

function unknownProbe(reason: string, path?: string): ClawLabIntegrationProbe {
	return {
		status: 'unknown',
		path,
		reason,
	}
}

function classifyHealth(parts: ClawLabIntegrationProbe[]): ClawLabIntegrationHealth {
	const statuses = parts.map((part) => part.status)
	if (statuses.every((status) => status === 'missing')) {
		return 'missing'
	}
	if (
		statuses.every((status) => status === 'present' || status === 'configured') &&
		statuses.includes('configured')
	) {
		return 'ready'
	}
	return 'partial'
}

async function safeReadText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8')
	} catch {
		return undefined
	}
}

function firstExisting(paths: string[]): string | undefined {
	return paths.find((path) => existsSync(path))
}

async function detectCodex(cwd: string): Promise<ClawLabIntegrationReport> {
	const cliPath = findExecutable('codex')
	const userConfigPath = firstExisting([join(resolveCodexHome(), 'config.toml')])
	const projectAdapterPath = firstExisting([
		join(cwd, '.codex', 'config.toml'),
		join(cwd, '.codex', 'AGENTS.md'),
	])
	const authPath = firstExisting([join(resolveCodexHome(), 'auth.json')])

	const cli = cliPath
		? presentProbe(cliPath, 'Codex CLI executable is on PATH')
		: missingProbe('Codex CLI executable was not found on PATH')
	const userConfig = userConfigPath
		? presentProbe(userConfigPath, 'User-level Codex config exists')
		: missingProbe('User-level Codex config.toml was not found')
	const projectAdapter = projectAdapterPath
		? presentProbe(projectAdapterPath, 'Project-local Codex adapter files exist')
		: missingProbe('Project-local .codex adapter files were not found')
	const auth =
		process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL
			? configuredProbe(
					process.env.OPENAI_API_KEY ? 'env:OPENAI_API_KEY' : 'env:OPENAI_BASE_URL',
					'OpenAI-compatible environment variables are present',
				)
			: authPath
				? configuredProbe(authPath, 'Codex auth.json exists')
				: missingProbe('No Codex auth.json or OPENAI_API_KEY was found')

	return {
		kind: 'codex',
		title: 'Codex',
		health: classifyHealth([cli, userConfig, projectAdapter, auth]),
		cli,
		userConfig,
		projectAdapter,
		auth,
		notes: [
			'Codex project config is only loaded for trusted projects.',
			'Auth presence does not prove that the remote API/session is currently valid.',
		],
	}
}

async function detectClaudeCode(cwd: string): Promise<ClawLabIntegrationReport> {
	const cliPath = findExecutable('claude')
	const userConfigPath = firstExisting([
		join(resolveClaudeHome(), 'settings.json'),
		join(resolveClaudeHome(), 'settings.local.json'),
	])
	const projectAdapterPath = firstExisting([
		join(cwd, '.claude', 'settings.local.json'),
		join(cwd, '.claude', 'agents', 'clawlab-research.md'),
	])

	const cli = cliPath
		? presentProbe(cliPath, 'Claude Code CLI executable is on PATH')
		: missingProbe('Claude Code CLI executable was not found on PATH')
	const userConfig = userConfigPath
		? presentProbe(userConfigPath, 'Claude Code settings file exists')
		: missingProbe('No Claude Code settings.json/settings.local.json was found')
	const projectAdapter = projectAdapterPath
		? presentProbe(projectAdapterPath, 'Project-local .claude adapter files exist')
		: missingProbe('Project-local .claude adapter files were not found')

	let auth: ClawLabIntegrationProbe = unknownProbe(
		'Claude Code auth is not directly provable from static config files alone',
	)
	if (process.env.ANTHROPIC_API_KEY) {
		auth = configuredProbe('env:ANTHROPIC_API_KEY', 'Anthropic API key environment variable is set')
	} else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
		auth = configuredProbe(
			'env:CLAUDE_CODE_OAUTH_TOKEN',
			'Claude Code OAuth token environment variable is set',
		)
	}

	return {
		kind: 'claude_code',
		title: 'Claude Code',
		health: classifyHealth([cli, userConfig, projectAdapter, auth]),
		cli,
		userConfig,
		projectAdapter,
		auth,
		notes: [
			'Claude Code usually authenticates through /login or provider-specific environment setup.',
			'Static file detection can confirm settings, but not a currently valid interactive session.',
		],
	}
}

async function detectOpenClaw(cwd: string): Promise<ClawLabIntegrationReport> {
	const cliPath = findExecutable('openclaw')
	const userConfigPath = firstExisting([join(resolveOpenClawHome(), 'openclaw.json')])
	const projectAdapterPath = firstExisting([
		join(cwd, '.openclaw', 'clawlab.project.json5'),
		join(cwd, '.openclaw', 'README.md'),
	])
	const configText = userConfigPath ? await safeReadText(userConfigPath) : undefined
	const auth =
		process.env.OMX_OPENCLAW === '1' || /"auth"\s*:|"profiles"\s*:/u.test(configText ?? '')
			? configuredProbe(
					userConfigPath ?? 'env:OMX_OPENCLAW',
					'OpenClaw configuration appears to include auth or profile wiring',
				)
			: missingProbe('No OpenClaw auth/profile signal was found in config or environment')

	const cli = cliPath
		? presentProbe(cliPath, 'OpenClaw CLI executable is on PATH')
		: missingProbe('OpenClaw CLI executable was not found on PATH')
	const userConfig = userConfigPath
		? presentProbe(userConfigPath, 'OpenClaw user config exists')
		: missingProbe('No ~/.openclaw/openclaw.json config was found')
	const projectAdapter = projectAdapterPath
		? presentProbe(projectAdapterPath, 'Project-local .openclaw adapter files exist')
		: missingProbe('Project-local .openclaw adapter files were not found')

	return {
		kind: 'openclaw',
		title: 'OpenClaw',
		health: classifyHealth([cli, userConfig, projectAdapter, auth]),
		cli,
		userConfig,
		projectAdapter,
		auth,
		notes: [
			'OpenClaw credentials normally belong in user-level config, not project-local files.',
			'Project-local OpenClaw files should stay as includes/examples unless your deployment policy says otherwise.',
		],
	}
}

export async function detectIntegration(
	kind: ClawLabIntegrationKind,
	cwd: string,
): Promise<ClawLabIntegrationReport> {
	if (kind === 'codex') {
		return detectCodex(cwd)
	}
	if (kind === 'claude_code') {
		return detectClaudeCode(cwd)
	}
	return detectOpenClaw(cwd)
}

export async function detectAllIntegrations(cwd: string): Promise<ClawLabIntegrationReport[]> {
	return Promise.all([
		detectIntegration('codex', cwd),
		detectIntegration('claude_code', cwd),
		detectIntegration('openclaw', cwd),
	])
}

async function writeTemplate(
	cwd: string,
	relativePath: string,
	content: string,
	force: boolean,
): Promise<ClawLabTemplateWriteResult> {
	const outputPath = join(cwd, relativePath)
	await mkdir(dirname(outputPath), { recursive: true })
	if (force) {
		await writeFile(outputPath, content, 'utf8')
		return 'written'
	}
	try {
		await writeFile(outputPath, content, { encoding: 'utf8', flag: 'wx' })
		return 'written'
	} catch (error) {
		const maybeError = error as { code?: string }
		if (maybeError.code === 'EEXIST') {
			return 'skipped'
		}
		throw error
	}
}

export async function initializeIntegration(
	kind: ClawLabIntegrationKind,
	cwd: string,
	force: boolean,
): Promise<ClawLabIntegrationInitResult> {
	const writes = []
	for (const template of getIntegrationTemplates(kind)) {
		const result = await writeTemplate(cwd, template.relativePath, template.content, force)
		writes.push({
			relativePath: template.relativePath,
			description: template.description,
			result,
		})
	}
	return {
		kind,
		writes,
	}
}
