import type { ExecutionTarget } from '../schemas.js'

export type CommandResult = {
	success: boolean
	stdout: string
	stderr: string
	exitCode?: number
}

export type BackgroundCommandResult = {
	jobId: string
	logPath?: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ExperimentExecutor {
	prepareEnvironment(target: ExecutionTarget): Promise<void>
	syncWorkspace(target: ExecutionTarget): Promise<void>
	runCommand(target: ExecutionTarget, command: string): Promise<CommandResult>
	runBackgroundCommand(target: ExecutionTarget, command: string): Promise<BackgroundCommandResult>
	streamLogs(target: ExecutionTarget, logPath: string): Promise<string>
	checkJobStatus(target: ExecutionTarget, jobId: string): Promise<JobStatus>
	stopJob(target: ExecutionTarget, jobId: string): Promise<boolean>
	collectArtifacts(target: ExecutionTarget, remotePaths: string[]): Promise<string[]>
}
