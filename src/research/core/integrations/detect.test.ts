import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
	detectIntegration,
	findExecutable,
	getIntegrationTemplates,
	initializeIntegration,
} from './index.js'

function makeTempRoot(): string {
	return mkdtempSync(join(os.tmpdir(), 'clawlab-integrations-'))
}

function makeExecutable(path: string): void {
	writeFileSync(path, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
	chmodSync(path, 0o755)
}

const envKeys = [
	'CODEX_HOME',
	'CLAUDE_CONFIG_DIR',
	'OPENCLAW_HOME',
	'OPENAI_API_KEY',
	'ANTHROPIC_API_KEY',
] as const
let tempRoots: string[] = []
const originalPath = process.env.PATH

afterEach(() => {
	for (const key of envKeys) {
		delete process.env[key]
	}
	process.env.PATH = originalPath
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true })
	}
	tempRoots = []
})

describe('findExecutable', () => {
	it('finds a command in a custom PATH', () => {
		const root = makeTempRoot()
		tempRoots.push(root)
		const binDir = join(root, 'bin')
		mkdirSync(binDir, { recursive: true })
		const commandPath = join(binDir, process.platform === 'win32' ? 'codex.cmd' : 'codex')
		makeExecutable(commandPath)
		expect(findExecutable('codex', binDir)).toBe(commandPath)
	})
})

describe('integration templates', () => {
	it('creates project-local Codex templates', async () => {
		const root = makeTempRoot()
		tempRoots.push(root)
		const result = await initializeIntegration('codex', root, false)
		expect(result.writes.length).toBe(getIntegrationTemplates('codex').length)
		expect(existsSync(join(root, '.codex', 'AGENTS.md'))).toBe(true)
		expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(true)
	})
})

describe('integration detection', () => {
	it('detects configured Codex from fake home and env auth', async () => {
		const root = makeTempRoot()
		const codexHome = join(root, 'codex-home')
		const binDir = join(root, 'bin')
		tempRoots.push(root)
		mkdirSync(codexHome, { recursive: true })
		mkdirSync(binDir, { recursive: true })
		makeExecutable(join(binDir, process.platform === 'win32' ? 'codex.cmd' : 'codex'))
		process.env.PATH = binDir
		writeFileSync(join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8')
		process.env.CODEX_HOME = codexHome
		process.env.OPENAI_API_KEY = 'test-key'
		await initializeIntegration('codex', root, false)
		const report = await detectIntegration('codex', root)
		expect(report.userConfig.status).toBe('present')
		expect(report.projectAdapter.status).toBe('present')
		expect(report.auth.status).toBe('configured')
		expect(report.health).toBe('ready')
	})

	it('marks Claude auth as unknown when only settings exist', async () => {
		const root = makeTempRoot()
		const claudeHome = join(root, 'claude-home')
		tempRoots.push(root)
		mkdirSync(claudeHome, { recursive: true })
		writeFileSync(join(claudeHome, 'settings.json'), '{}\n', 'utf8')
		process.env.CLAUDE_CONFIG_DIR = claudeHome
		await initializeIntegration('claude_code', root, false)
		const report = await detectIntegration('claude_code', root)
		expect(report.userConfig.status).toBe('present')
		expect(report.projectAdapter.status).toBe('present')
		expect(report.auth.status).toBe('unknown')
	})

	it('detects OpenClaw auth/profile hints from config text', async () => {
		const root = makeTempRoot()
		const openclawHome = join(root, 'openclaw-home')
		tempRoots.push(root)
		mkdirSync(openclawHome, { recursive: true })
		writeFileSync(
			join(openclawHome, 'openclaw.json'),
			'{ "auth": { "profiles": { "default": {} } } }\n',
			'utf8',
		)
		process.env.OPENCLAW_HOME = openclawHome
		await initializeIntegration('openclaw', root, false)
		const report = await detectIntegration('openclaw', root)
		expect(report.userConfig.status).toBe('present')
		expect(report.projectAdapter.status).toBe('present')
		expect(report.auth.status).toBe('configured')
	})
})
