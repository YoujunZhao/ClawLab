import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import type { ExecutionTarget, RemoteMachineConfig } from '../schemas.js'
import type {
	BackgroundCommandResult,
	CommandResult,
	ExperimentExecutor,
	JobStatus,
} from './experimentExecutor.js'

async function commandExists(command: string): Promise<boolean> {
	try {
		if (process.platform === 'win32') {
			await execa('where', [command])
		} else {
			await execa('which', [command])
		}
		return true
	} catch {
		return false
	}
}

function quoteSingle(value: string): string {
	return `'${value.replace(/'/gu, `'\"'\"'`)}'`
}

export class SSHExecutor implements ExperimentExecutor {
	constructor(
		private readonly machines: ReadonlyMap<string, RemoteMachineConfig>,
		private readonly localScratchRoot: string,
	) {}

	private getMachine(target: ExecutionTarget): RemoteMachineConfig {
		if (target.type !== 'ssh' || !target.machineId) {
			throw new Error('SSH target requires a machineId')
		}
		const machine = this.machines.get(target.machineId)
		if (!machine) {
			throw new Error(`Unknown remote machine: ${target.machineId}`)
		}
		return machine
	}

	private async buildLauncher(
		machine: RemoteMachineConfig,
		program: 'ssh' | 'scp',
	): Promise<{ command: string; args: string[] }> {
		const port = String(machine.port ?? 22)
		if (machine.authType === 'ssh_key') {
			const keyArgs = machine.sshKeyPath ? ['-i', machine.sshKeyPath] : []
			return {
				command: program,
				args:
					program === 'ssh'
						? [...keyArgs, '-p', port, `${machine.username}@${machine.host}`]
						: [...keyArgs, '-P', port],
			}
		}

		if (process.platform === 'win32' && (await commandExists('plink'))) {
			return {
				command: program === 'ssh' ? 'plink' : 'pscp',
				args:
					program === 'ssh'
						? ['-P', port, '-pw', machine.password ?? '', `${machine.username}@${machine.host}`]
						: ['-P', port, '-pw', machine.password ?? ''],
			}
		}

		if (await commandExists('sshpass')) {
			return {
				command: 'sshpass',
				args: [
					'-p',
					machine.password ?? '',
					program,
					...(program === 'ssh'
						? ['-p', port, `${machine.username}@${machine.host}`]
						: ['-P', port]),
				],
			}
		}

		throw new Error('Password-based SSH requires plink/pscp on Windows or sshpass on POSIX')
	}

	private wrapRemoteCommand(
		machine: RemoteMachineConfig,
		target: ExecutionTarget,
		command: string,
	): string {
		const exports: string[] = []
		if (target.gpuAllocation?.visibleDevices) {
			exports.push(
				`export CUDA_VISIBLE_DEVICES=${quoteSingle(target.gpuAllocation.visibleDevices)}`,
			)
		}
		const envSetup =
			machine.pythonEnvType === 'conda' && machine.pythonEnvName
				? `source ~/.bashrc && conda activate ${quoteSingle(machine.pythonEnvName)}`
				: machine.pythonEnvType === 'venv' && machine.pythonEnvName
					? `source ${quoteSingle(machine.pythonEnvName)}/bin/activate`
					: 'true'
		const parts = [
			`mkdir -p ${quoteSingle(target.cwd)}`,
			`cd ${quoteSingle(target.cwd)}`,
			envSetup,
			...exports,
			command,
		]
		return `bash -lc ${quoteSingle(parts.join(' && '))}`
	}

	async prepareEnvironment(target: ExecutionTarget): Promise<void> {
		const machine = this.getMachine(target)
		const launcher = await this.buildLauncher(machine, 'ssh')
		await execa(launcher.command, [
			...launcher.args,
			this.wrapRemoteCommand(machine, target, 'pwd'),
		])
	}

	async syncWorkspace(target: ExecutionTarget): Promise<void> {
		const machine = this.getMachine(target)
		const launcher = await this.buildLauncher(machine, 'ssh')
		await execa(launcher.command, [
			...launcher.args,
			this.wrapRemoteCommand(machine, target, 'mkdir -p .'),
		])
	}

	async runCommand(target: ExecutionTarget, command: string): Promise<CommandResult> {
		const machine = this.getMachine(target)
		const launcher = await this.buildLauncher(machine, 'ssh')
		const result = await execa(
			launcher.command,
			[...launcher.args, this.wrapRemoteCommand(machine, target, command)],
			{
				reject: false,
			},
		)
		return {
			success: result.exitCode === 0,
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
		}
	}

	async runBackgroundCommand(
		target: ExecutionTarget,
		command: string,
	): Promise<BackgroundCommandResult> {
		const machine = this.getMachine(target)
		const launcher = await this.buildLauncher(machine, 'ssh')
		const logPath = `${target.cwd.replace(/[\\/]/gu, '/')}/.research-jobs/${Date.now()}.log`
		const remote = this.wrapRemoteCommand(
			machine,
			target,
			`mkdir -p .research-jobs && nohup ${command} > ${quoteSingle(logPath)} 2>&1 & echo $!`,
		)
		const result = await execa(launcher.command, [...launcher.args, remote])
		return {
			jobId: result.stdout.trim(),
			logPath,
		}
	}

	async streamLogs(target: ExecutionTarget, logPath: string): Promise<string> {
		const result = await this.runCommand(
			target,
			`test -f ${quoteSingle(logPath)} && tail -n 200 ${quoteSingle(logPath)} || true`,
		)
		return result.stdout
	}

	async checkJobStatus(target: ExecutionTarget, jobId: string): Promise<JobStatus> {
		const result = await this.runCommand(target, `ps -p ${quoteSingle(jobId)} -o stat= || true`)
		const status = result.stdout.trim()
		if (!status) {
			return 'done'
		}
		if (status.includes('Z')) {
			return 'failed'
		}
		return 'running'
	}

	async stopJob(target: ExecutionTarget, jobId: string): Promise<boolean> {
		const result = await this.runCommand(target, `kill ${quoteSingle(jobId)}`)
		return result.success
	}

	async collectArtifacts(target: ExecutionTarget, remotePaths: string[]): Promise<string[]> {
		const machine = this.getMachine(target)
		const launcher = await this.buildLauncher(machine, 'scp')
		const localDir = join(this.localScratchRoot, 'remote-collected')
		await mkdir(localDir, { recursive: true })
		const collected: string[] = []
		for (const remotePath of remotePaths) {
			const localPath = join(localDir, basename(remotePath))
			const remoteRef = `${machine.username}@${machine.host}:${remotePath}`
			await execa(launcher.command, [...launcher.args, remoteRef, localPath], {
				reject: false,
			})
			collected.push(localPath)
		}
		return collected
	}

	async gpuStatus(target: ExecutionTarget): Promise<string> {
		const result = await this.runCommand(
			target,
			'nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits',
		)
		return result.stdout
	}
}
