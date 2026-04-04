export type SDKControlRequest = {
	type: 'control_request'
	request_id: string
	request: Record<string, unknown>
}

export type SDKControlResponse = {
	type: 'control_response'
	request_id?: string
	response: Record<string, unknown>
}
