import type {
	FinalSummarizationState,
	ResearchSessionState,
	ResearchState,
	TopLevelState,
} from '../schemas.js'

const TOP_LEVEL_TRANSITIONS: Record<TopLevelState, readonly TopLevelState[]> = {
	IDLE: ['MISSION_FRAMING', 'ARCHIVED'],
	MISSION_FRAMING: ['RESEARCH_LOOP', 'ARCHIVED'],
	RESEARCH_LOOP: ['REPORTING', 'WAITING_FOR_RESOURCES', 'PAUSED', 'ARCHIVED'],
	REPORTING: [
		'RESEARCH_LOOP',
		'WAITING_FOR_RESOURCES',
		'PAUSED',
		'READY_FOR_SUMMARIZATION',
		'ARCHIVED',
	],
	WAITING_FOR_RESOURCES: ['RESEARCH_LOOP', 'PAUSED', 'ARCHIVED'],
	PAUSED: ['RESEARCH_LOOP', 'ARCHIVED'],
	READY_FOR_SUMMARIZATION: ['RESEARCH_LOOP', 'FINAL_SUMMARIZATION', 'ARCHIVED'],
	FINAL_SUMMARIZATION: ['READY_FOR_SUMMARIZATION', 'ARCHIVED'],
	ARCHIVED: [],
}

const RESEARCH_TRANSITIONS: Record<ResearchState, readonly ResearchState[]> = {
	RESEARCHING: ['FORMING_HYPOTHESES'],
	FORMING_HYPOTHESES: ['BRANCH_SELECTION'],
	BRANCH_SELECTION: ['PLANNING_PATCH'],
	PLANNING_PATCH: ['PATCHING'],
	PATCHING: ['VALIDATING'],
	VALIDATING: ['RUNNING_EXPERIMENT', 'DEBUGGING'],
	RUNNING_EXPERIMENT: ['REFLECTING', 'DEBUGGING'],
	DEBUGGING: ['PLANNING_PATCH', 'VALIDATING', 'RESEARCH_ROUND_DONE'],
	REFLECTING: ['RESEARCH_ROUND_DONE'],
	RESEARCH_ROUND_DONE: ['RESEARCHING'],
}

const SUMMARIZATION_TRANSITIONS: Record<
	FinalSummarizationState,
	readonly FinalSummarizationState[]
> = {
	SUMMARY_PLANNING: ['ARTIFACT_AGGREGATION'],
	ARTIFACT_AGGREGATION: ['NARRATIVE_SYNTHESIS'],
	NARRATIVE_SYNTHESIS: ['FINAL_REPORT_DRAFTING'],
	FINAL_REPORT_DRAFTING: ['FINAL_OUTPUT_READY'],
	FINAL_OUTPUT_READY: [],
}

function assertTransition<T extends string>(
	from: T,
	to: T,
	transitions: Record<T, readonly T[]>,
	label: string,
): void {
	if (!transitions[from]?.includes(to)) {
		throw new Error(`Invalid ${label} transition: ${from} -> ${to}`)
	}
}

export class ResearchStateMachine {
	constructor(private readonly state: ResearchSessionState) {}

	transitionTopLevel(next: TopLevelState): ResearchSessionState {
		assertTransition(this.state.topLevelState, next, TOP_LEVEL_TRANSITIONS, 'top-level state')
		return {
			...this.state,
			topLevelState: next,
			updatedAt: new Date().toISOString(),
		}
	}

	transitionResearch(next: ResearchState): ResearchSessionState {
		const current = this.state.researchState
		if (!current) {
			return {
				...this.state,
				researchState: next,
				updatedAt: new Date().toISOString(),
			}
		}
		assertTransition(current, next, RESEARCH_TRANSITIONS, 'research state')
		return {
			...this.state,
			researchState: next,
			updatedAt: new Date().toISOString(),
		}
	}

	transitionFinal(next: FinalSummarizationState): ResearchSessionState {
		const current = this.state.finalSummarizationState
		if (!current) {
			return {
				...this.state,
				finalSummarizationState: next,
				updatedAt: new Date().toISOString(),
			}
		}
		assertTransition(current, next, SUMMARIZATION_TRANSITIONS, 'final summarization state')
		return {
			...this.state,
			finalSummarizationState: next,
			updatedAt: new Date().toISOString(),
		}
	}
}
