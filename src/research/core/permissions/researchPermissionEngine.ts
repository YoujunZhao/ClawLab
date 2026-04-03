import type { ResearchPermissionMode } from '../schemas.js'
import type { ResearchTool } from '../tool-registry/toolRegistry.js'

const PLAN_MODE_DISALLOWED_CATEGORIES = new Set([
	'repo-write',
	'experiment',
	'remote',
	'summarize',
	'orchestration-write',
])

export class ResearchPermissionEngine {
	constructor(private mode: ResearchPermissionMode) {}

	getMode(): ResearchPermissionMode {
		return this.mode
	}

	setMode(mode: ResearchPermissionMode): void {
		this.mode = mode
	}

	assertCanRun(tool: ResearchTool<unknown, unknown>): void {
		if (
			tool.name === 'enter_plan_mode' ||
			tool.name === 'exit_plan_mode' ||
			tool.name === 'worktree_manager'
		) {
			return
		}
		if (this.mode === 'bypassPermissions') {
			return
		}
		if (this.mode === 'plan') {
			for (const category of tool.categories) {
				if (PLAN_MODE_DISALLOWED_CATEGORIES.has(category)) {
					throw new Error(
						`Tool "${tool.name}" is not allowed in plan mode because it belongs to the "${category}" category`,
					)
				}
			}
		}
	}
}
