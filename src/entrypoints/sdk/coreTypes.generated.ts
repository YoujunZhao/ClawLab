export type SDKMessage = {
	type: string
	[key: string]: unknown
}

export type SDKUserMessage = {
	type: 'user'
	message?: string
	[key: string]: unknown
}

export type SDKResultSuccess = {
	type: 'result'
	isError?: false
	result?: unknown
	[key: string]: unknown
}

export type SDKResultError = {
	type: 'result'
	isError: true
	error?: string
	[key: string]: unknown
}

export type SDKResultMessage = SDKResultSuccess | SDKResultError

export type SDKSessionInfo = {
	sessionId: string
	title?: string
	createdAt?: string
	updatedAt?: string
	[key: string]: unknown
}
