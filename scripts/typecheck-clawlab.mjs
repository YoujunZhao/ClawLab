import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const files = [
	'src/research/core/integrations/types.ts',
	'src/research/core/integrations/templates.ts',
	'src/research/core/integrations/detect.ts',
	'src/research/core/integrations/index.ts',
	'src/research/rebuttal/types.ts',
	'src/research/rebuttal/venuePolicies.ts',
	'src/research/rebuttal/io.ts',
	'src/research/rebuttal/analysis.ts',
	'src/research/rebuttal/repoEvidence.ts',
	'src/research/rebuttal/index.ts',
	'src/research/skills/types.ts',
	'src/research/skills/registry.ts',
].map((file) => join(repoRoot, file))

const tempDir = mkdtempSync(join(os.tmpdir(), 'clawlab-typecheck-'))
const tsconfigPath = join(tempDir, 'tsconfig.json')

const config = {
	compilerOptions: {
		target: 'ESNext',
		module: 'ESNext',
		moduleResolution: 'bundler',
		strict: true,
		skipLibCheck: true,
		resolveJsonModule: true,
		isolatedModules: true,
		noResolve: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		esModuleInterop: true,
		baseUrl: repoRoot,
		types: ['node'],
		typeRoots: [join(repoRoot, 'node_modules', '@types')],
		paths: {
			'bun:bundle': [join(repoRoot, 'src/types/bun-bundle.d.ts')],
		},
	},
	files,
	include: [],
	exclude: [],
}

writeFileSync(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

const tscEntry = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const result = spawnSync(process.execPath, [tscEntry, '-p', tsconfigPath], {
	cwd: tempDir,
	stdio: 'inherit',
})

rmSync(tempDir, { recursive: true, force: true })
process.exit(result.status ?? 1)
