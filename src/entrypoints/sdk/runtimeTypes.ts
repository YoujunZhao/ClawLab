import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type {
	SDKMessage,
	SDKResultMessage,
	SDKSessionInfo,
	SDKUserMessage,
} from './coreTypes.generated.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type AnyZodRawShape = Record<string, unknown>

export type InferShape<Schema extends AnyZodRawShape> = {
	[K in keyof Schema]: unknown
}

export type SessionMessage = SDKMessage

export type Query = AsyncIterable<SDKMessage>

export type InternalQuery = AsyncIterable<SDKMessage>

export type Options = Record<string, unknown>

export type InternalOptions = Record<string, unknown>

export type GetSessionMessagesOptions = {
	dir?: string
	limit?: number
	offset?: number
	includeSystemMessages?: boolean
}

export type ListSessionsOptions = {
	dir?: string
	limit?: number
	offset?: number
}

export type GetSessionInfoOptions = {
	dir?: string
}

export type SessionMutationOptions = {
	dir?: string
}

export type ForkSessionOptions = {
	dir?: string
	upToMessageId?: string
}

export type ForkSessionResult = {
	sessionId: string
}

export type SDKSessionOptions = {
	model?: string
	cwd?: string
	effortLevel?: EffortLevel
}

export type SDKSession = {
	id: string
	send: (message: string | SDKUserMessage) => Promise<SDKResultMessage>
	close: () => Promise<void>
}

export type SdkMcpToolDefinition<Schema extends AnyZodRawShape = AnyZodRawShape> = {
	name: string
	description: string
	inputSchema: Schema
	handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
	annotations?: ToolAnnotations
	searchHint?: string
	alwaysLoad?: boolean
}

export type McpSdkServerConfigWithInstance = {
	name: string
	version?: string
	tools?: Array<SdkMcpToolDefinition>
	instance?: unknown
}

export type { SDKSessionInfo }
