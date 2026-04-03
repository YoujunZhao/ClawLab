import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execaCommand } from 'execa'
import type { ExecutionTarget } from '../schemas.js'
import type {
	BackgroundCommandResult,
	CommandResult,
	ExperimentExecutor,
	JobStatus,
} from './experimentExecutor.js'

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

export class LocalExecutor implements ExperimentExecutor {
	async prepareEnvironment(target: ExecutionTarget): Promise<void> {
		await mkdir(target.cwd, { recursive: true })
	}

	async syncWorkspace(_target: ExecutionTarget): Promise<void> {
		return
	}

	async runCommand(target: ExecutionTarget, command: string): Promise<CommandResult> {
		try {
			const result = await execaCommand(command, {
				cwd: target.cwd,
				shell: true,
				reject: false,
			})
			return {
				success: result.exitCode === 0,
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			return {
				success: false,
				stdout: '',
				stderr: message,
			}
		}
	}

	async runBackgroundCommand(
		target: ExecutionTarget,
		command: string,
	): Promise<BackgroundCommandResult> {
		const logDir = join(target.cwd, '.research-jobs')
		await mkdir(logDir, { recursive: true })
		const logPath = join(logDir, `${Date.now()}.log`)
		const child = spawn(command, {
			cwd: target.cwd,
			shell: true,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		child.stdout?.pipe(createWriteStream(logPath, { flags: 'a' }))
		child.stderr?.pipe(createWriteStream(logPath, { flags: 'a' }))
		child.unref()
		return {
			jobId: String(child.pid),
			logPath,
		}
	}

	async streamLogs(_target: ExecutionTarget, logPath: string): Promise<string> {
		try {
			const content = await readFile(logPath, 'utf8')
			return content.split(/\r?\n/u).slice(-200).join('\n')
		} catch {
			return ''
		}
	}

	async checkJobStatus(target: ExecutionTarget, jobId: string): Promise<JobStatus> {
		const pid = Number(jobId)
		if (!Number.isFinite(pid) || pid <= 0) {
			return 'failed'
		}
		if (processIsRunning(pid)) {
			return 'running'
		}
		const logDir = join(target.cwd, '.research-jobs')
		try {
			await stat(logDir)
			return 'done'
		} catch {
			return 'failed'
		}
	}

	async stopJob(_target: ExecutionTarget, jobId: string): Promise<boolean> {
		const pid = Number(jobId)
		if (!Number.isFinite(pid) || pid <= 0) {
			return false
		}
		try {
			process.kill(pid)
			return true
		} catch {
			return false
		}
	}

	async collectArtifacts(_target: ExecutionTarget, remotePaths: string[]): Promise<string[]> {
		return remotePaths
	}
}
