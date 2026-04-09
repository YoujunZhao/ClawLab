import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { RebuttalInputBundle } from './types.js'

function sanitizeBinaryText(buffer: Buffer): string {
	return buffer
		.toString('utf8')
		.replace(/[^\t\n\r -~]+/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
}

export async function readDocumentText(path: string): Promise<string> {
	const extension = extname(path).toLowerCase()
	if (extension === '.pdf') {
		return sanitizeBinaryText(await readFile(path))
	}
	return (await readFile(path, 'utf8')).replace(/\r\n/gu, '\n').trim()
}

export async function ensureRebuttalRunDir(baseDir: string): Promise<string> {
	const runDir = join(baseDir, `run_${new Date().toISOString().replace(/[:.]/gu, '-')}`)
	await mkdir(runDir, { recursive: true })
	return runDir
}

export async function persistInputBundle(
	runDir: string,
	input: RebuttalInputBundle,
): Promise<void> {
	await writeFile(join(runDir, 'inputs.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8')
}

export async function persistTextArtifact(
	runDir: string,
	fileName: string,
	content: string,
): Promise<string> {
	const path = join(runDir, fileName)
	await writeFile(path, `${content}\n`, 'utf8')
	return path
}

export async function persistJsonArtifact(
	runDir: string,
	fileName: string,
	payload: unknown,
): Promise<string> {
	const path = join(runDir, fileName)
	await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
	return path
}
