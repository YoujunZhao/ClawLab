export interface ResearchMcpBridge {
	isEnabled(): boolean
	listCapabilities(): Promise<string[]>
}

export class DisabledResearchMcpBridge implements ResearchMcpBridge {
	isEnabled(): boolean {
		return false
	}

	async listCapabilities(): Promise<string[]> {
		return []
	}
}
