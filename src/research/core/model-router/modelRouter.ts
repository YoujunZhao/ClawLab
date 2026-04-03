import { OAUTH_BETA_HEADER, getOauthConfig } from '../../../constants/oauth.js'
import {
	checkAndRefreshOAuthTokenIfNeeded,
	getAnthropicApiKey,
	getClaudeAIOAuthTokens,
	getClaudeAIOAuthTokensAsync,
} from '../../../utils/auth.js'
import type { ResearchModelConnection, TaskModelOverrides } from '../schemas.js'

export type ModelTask = 'research' | 'code' | 'report' | 'summary'

export type ModelResponse = {
	provider: string
	model: string
	content: string
	metadata?: Record<string, unknown>
}

export type ModelConnectionSummary = {
	provider: string
	model: string
	taskModels: TaskModelOverrides
	baseUrl?: string
	authMode: 'oauth' | 'api_key' | 'none'
	status: 'ready' | 'stub' | 'unconfigured'
	displayName?: string
}

export interface ModelRouter {
	route(task: ModelTask, prompt: string): Promise<ModelResponse>
	describe(): ModelConnectionSummary
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gpt-4.1-mini'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MAX_OUTPUT_TOKENS = 1400

function taskSystemPrompt(task: ModelTask): string {
	switch (task) {
		case 'code':
			return 'You are ClawLab coding support. Return concise engineering guidance grounded in the repo and experiment objective.'
		case 'report':
			return 'You are ClawLab reporting support. Return concise round-report prose with no hype and no unsupported claims.'
		case 'summary':
			return 'You are ClawLab summarization support. Write artifact-grounded technical summaries and state uncertainty explicitly.'
		default:
			return 'You are ClawLab research support. Propose evidence-grounded next steps and avoid speculation.'
	}
}

function normalizeConnection(connection?: ResearchModelConnection): ResearchModelConnection {
	return {
		provider: connection?.provider ?? 'auto',
		displayName: connection?.displayName,
		model: connection?.model,
		taskModels: connection?.taskModels ?? {},
		baseUrl: connection?.baseUrl,
		apiKeyEnvVar: connection?.apiKeyEnvVar,
	}
}

function resolveModel(
	connection: ResearchModelConnection,
	task: ModelTask,
	fallback: string,
): string {
	return connection.taskModels[task] ?? connection.model ?? fallback
}

function parseAnthropicText(payload: unknown): string {
	const content = Array.isArray((payload as { content?: unknown[] })?.content)
		? (payload as { content: Array<Record<string, unknown>> }).content
		: []
	return content
		.filter((block) => block.type === 'text')
		.map((block) => String(block.text ?? ''))
		.join('\n')
		.trim()
}

function parseOpenAICompatibleText(payload: unknown): string {
	const choices = Array.isArray((payload as { choices?: unknown[] })?.choices)
		? (payload as { choices: Array<Record<string, unknown>> }).choices
		: []
	const first = choices[0]
	if (!first) {
		return ''
	}
	const message = first.message as { content?: string | Array<Record<string, unknown>> } | undefined
	if (typeof message?.content === 'string') {
		return message.content.trim()
	}
	if (Array.isArray(message?.content)) {
		return message.content
			.map((block) => String(block.text ?? block.content ?? ''))
			.join('\n')
			.trim()
	}
	return ''
}

async function requestJson(params: {
	url: string
	headers: Record<string, string>
	body: Record<string, unknown>
}): Promise<unknown> {
	const response = await fetch(params.url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...params.headers,
		},
		body: JSON.stringify(params.body),
	})
	const text = await response.text()
	if (!response.ok) {
		throw new Error(
			`Model request failed (${response.status} ${response.statusText}): ${text.slice(0, 500)}`,
		)
	}
	return JSON.parse(text) as unknown
}

export class StubModelRouter implements ModelRouter {
	describe(): ModelConnectionSummary {
		return {
			provider: 'stub',
			model: 'stub',
			taskModels: {},
			authMode: 'none',
			status: 'stub',
			displayName: 'ClawLab Stub Router',
		}
	}

	async route(task: ModelTask, prompt: string): Promise<ModelResponse> {
		return {
			provider: 'stub',
			model: 'stub',
			content: '',
			metadata: {
				reason: 'No live model connection configured for ClawLab',
				task,
				promptPreview: prompt.slice(0, 120),
			},
		}
	}
}

class AnthropicModelRouter implements ModelRouter {
	constructor(private readonly connection: ResearchModelConnection) {}

	describe(): ModelConnectionSummary {
		return {
			provider: this.connection.provider,
			model: this.connection.model ?? DEFAULT_ANTHROPIC_MODEL,
			taskModels: this.connection.taskModels,
			baseUrl:
				this.connection.baseUrl ??
				(this.connection.provider === 'anthropic_oauth'
					? getOauthConfig().BASE_API_URL
					: (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com')),
			authMode: this.connection.provider === 'anthropic_oauth' ? 'oauth' : 'api_key',
			status: 'ready',
			displayName: this.connection.displayName,
		}
	}

	private async buildHeaders(): Promise<Record<string, string>> {
		if (this.connection.provider === 'anthropic_oauth') {
			await checkAndRefreshOAuthTokenIfNeeded()
			const tokens = await getClaudeAIOAuthTokensAsync()
			if (!tokens?.accessToken) {
				throw new Error('No Claude OAuth session found for ClawLab. Run the CLI login flow first.')
			}
			return {
				authorization: `Bearer ${tokens.accessToken}`,
				'anthropic-beta': OAUTH_BETA_HEADER,
				'anthropic-version': '2023-06-01',
			}
		}

		const configuredEnvVar = this.connection.apiKeyEnvVar
		const apiKey =
			(configuredEnvVar ? process.env[configuredEnvVar] : undefined) ??
			process.env.ANTHROPIC_API_KEY ??
			getAnthropicApiKey()
		if (!apiKey) {
			throw new Error(
				`No Anthropic API key available for ClawLab. Set ${
					configuredEnvVar ?? 'ANTHROPIC_API_KEY'
				} or log in with OAuth.`,
			)
		}
		return {
			'anthropic-version': '2023-06-01',
			'x-api-key': apiKey,
		}
	}

	async route(task: ModelTask, prompt: string): Promise<ModelResponse> {
		const model = resolveModel(this.connection, task, DEFAULT_ANTHROPIC_MODEL)
		const baseUrl =
			this.connection.baseUrl ??
			(this.connection.provider === 'anthropic_oauth'
				? getOauthConfig().BASE_API_URL
				: (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'))
		const payload = await requestJson({
			url: `${baseUrl.replace(/\/$/, '')}/v1/messages`,
			headers: await this.buildHeaders(),
			body: {
				model,
				max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
				system: taskSystemPrompt(task),
				messages: [
					{
						role: 'user',
						content: prompt,
					},
				],
			},
		})
		const content = parseAnthropicText(payload)
		if (!content) {
			throw new Error('Anthropic model response did not contain text content')
		}
		return {
			provider: this.connection.provider,
			model,
			content,
			metadata: {
				baseUrl,
			},
		}
	}
}

class OpenAICompatibleModelRouter implements ModelRouter {
	constructor(private readonly connection: ResearchModelConnection) {}

	describe(): ModelConnectionSummary {
		return {
			provider: 'openai_compatible',
			model: this.connection.model ?? DEFAULT_OPENAI_COMPATIBLE_MODEL,
			taskModels: this.connection.taskModels,
			baseUrl: this.connection.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
			authMode: 'api_key',
			status: 'ready',
			displayName: this.connection.displayName,
		}
	}

	async route(task: ModelTask, prompt: string): Promise<ModelResponse> {
		const envVar = this.connection.apiKeyEnvVar ?? 'OPENAI_API_KEY'
		const apiKey = process.env[envVar]
		if (!apiKey) {
			throw new Error(`No API key found for the OpenAI-compatible connection. Set ${envVar}.`)
		}
		const model = resolveModel(this.connection, task, DEFAULT_OPENAI_COMPATIBLE_MODEL)
		const baseUrl = this.connection.baseUrl ?? DEFAULT_OPENAI_BASE_URL
		const payload = await requestJson({
			url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
			headers: {
				authorization: `Bearer ${apiKey}`,
			},
			body: {
				model,
				temperature: 0.2,
				messages: [
					{
						role: 'system',
						content: taskSystemPrompt(task),
					},
					{
						role: 'user',
						content: prompt,
					},
				],
			},
		})
		const content = parseOpenAICompatibleText(payload)
		if (!content) {
			throw new Error('OpenAI-compatible model response did not contain text content')
		}
		return {
			provider: 'openai_compatible',
			model,
			content,
			metadata: {
				baseUrl,
			},
		}
	}
}

class AutoModelRouter implements ModelRouter {
	private readonly fallback = new StubModelRouter()

	constructor(private readonly connection: ResearchModelConnection) {}

	describe(): ModelConnectionSummary {
		const syncOauth = getClaudeAIOAuthTokens()
		if (syncOauth?.accessToken) {
			return {
				provider: 'anthropic_oauth',
				model: this.connection.model ?? DEFAULT_ANTHROPIC_MODEL,
				taskModels: this.connection.taskModels,
				baseUrl: getOauthConfig().BASE_API_URL,
				authMode: 'oauth',
				status: 'ready',
				displayName: this.connection.displayName ?? 'Claude CLI OAuth',
			}
		}
		if (
			process.env[this.connection.apiKeyEnvVar ?? 'ANTHROPIC_API_KEY'] ??
			process.env.ANTHROPIC_API_KEY ??
			getAnthropicApiKey()
		) {
			return {
				provider: 'anthropic_api_key',
				model: this.connection.model ?? DEFAULT_ANTHROPIC_MODEL,
				taskModels: this.connection.taskModels,
				baseUrl:
					this.connection.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
				authMode: 'api_key',
				status: 'ready',
				displayName: this.connection.displayName,
			}
		}
		return this.fallback.describe()
	}

	async route(task: ModelTask, prompt: string): Promise<ModelResponse> {
		const oauth = await getClaudeAIOAuthTokensAsync()
		if (oauth?.accessToken) {
			return new AnthropicModelRouter({
				...this.connection,
				provider: 'anthropic_oauth',
			}).route(task, prompt)
		}
		const envVar = this.connection.apiKeyEnvVar ?? 'ANTHROPIC_API_KEY'
		if (process.env[envVar] ?? process.env.ANTHROPIC_API_KEY ?? getAnthropicApiKey()) {
			return new AnthropicModelRouter({
				...this.connection,
				provider: 'anthropic_api_key',
			}).route(task, prompt)
		}
		return this.fallback.route(task, prompt)
	}
}

export function createModelRouter(connection?: ResearchModelConnection): ModelRouter {
	const normalized = normalizeConnection(connection)
	switch (normalized.provider) {
		case 'anthropic_oauth':
		case 'anthropic_api_key':
			return new AnthropicModelRouter(normalized)
		case 'openai_compatible':
			return new OpenAICompatibleModelRouter(normalized)
		case 'stub':
			return new StubModelRouter()
		default:
			return new AutoModelRouter(normalized)
	}
}
