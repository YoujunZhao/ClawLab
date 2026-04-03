import { randomUUID } from 'node:crypto'

export function createResearchId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function createRoundLabel(roundNumber: number): string {
	return `round_${String(roundNumber).padStart(3, '0')}`
}

export function createRunLabel(runNumber: number): string {
	return `run_${String(runNumber).padStart(3, '0')}`
}
