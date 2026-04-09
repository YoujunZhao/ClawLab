import type { ClawLabIntegrationKind, ClawLabProjectTemplate } from './types.js'

function buildCodexAgentsTemplate(): string {
	return [
		'# ClawLab Codex Adapter',
		'',
		'Use ClawLab as an artifact-first research harness in this repository.',
		'',
		'Working rules:',
		'- prefer branch-isolated work over ad-hoc edits',
		'- validate before experiments',
		'- keep round reports and rebuttal artifacts under `.clawlab/`',
		'- do not write final papers or rebuttals unless explicitly asked',
		'',
		'Primary local surfaces:',
		'- `clawlab /research start ...` for research missions',
		'- `clawlab /research rebuttal ...` for rebuttal planning and drafting',
		'- `clawlab /research integration ...` for native tool integration checks',
		'',
	].join('\n')
}

function buildCodexConfigTemplate(): string {
	return [
		'# Project-local Codex configuration for ClawLab.',
		'# Codex only loads project config for trusted projects.',
		'',
		'model = "gpt-5.4"',
		'',
		'[profiles.clawlab_research]',
		'model = "gpt-5.4"',
		'',
	].join('\n')
}

function buildClaudeAgentTemplate(): string {
	return [
		'---',
		'name: clawlab-research',
		'description: Artifact-first ClawLab research and rebuttal workflow for this repository.',
		'---',
		'',
		'Follow the ClawLab workflow in this project:',
		'- keep artifacts under `.clawlab/`',
		'- prefer explicit mission / rebuttal configs',
		'- do not claim experiments, integrations, or rebuttal output succeeded unless validated',
		'- keep final writing separate from normal research rounds',
		'',
	].join('\n')
}

function buildClaudeSettingsTemplate(): string {
	return `${JSON.stringify(
		{
			env: {
				CLAWLAB_PROJECT_ROOT: '.',
			},
			permissions: {
				deny: [],
			},
		},
		null,
		2,
	)}\n`
}

function buildOpenClawConfigTemplate(): string {
	return [
		'{',
		'  // Project-local OpenClaw example for ClawLab.',
		'  // Include this file from your user-level ~/.openclaw/openclaw.json if desired.',
		'  "gateways": {',
		'    "clawlab-local": {',
		'      "type": "http",',
		'      "url": "http://localhost:3333/openclaw/clawlab"',
		'    }',
		'  },',
		'  "hooks": {',
		'    "session-end": {',
		'      "enabled": true,',
		'      "gateway": "clawlab-local",',
		'      "instruction": "Summarize the ClawLab session for {{projectPath}} and point to any rebuttal artifacts."',
		'    }',
		'  }',
		'}',
		'',
	].join('\n')
}

function buildOpenClawReadmeTemplate(): string {
	return [
		'# ClawLab OpenClaw Adapter',
		'',
		'This directory contains project-local OpenClaw examples for ClawLab.',
		'',
		'Recommended flow:',
		'1. Copy or include `clawlab.project.json5` from your user-level OpenClaw config.',
		'2. Point the HTTP gateway to a service that can consume ClawLab session summaries.',
		'3. Keep provider credentials in user-level OpenClaw config, not in this repository.',
		'',
	].join('\n')
}

export function getIntegrationTemplates(kind: ClawLabIntegrationKind): ClawLabProjectTemplate[] {
	if (kind === 'codex') {
		return [
			{
				relativePath: '.codex/AGENTS.md',
				description: 'Project-local Codex agent instructions for ClawLab',
				content: buildCodexAgentsTemplate(),
			},
			{
				relativePath: '.codex/config.toml',
				description: 'Project-local Codex config template for ClawLab',
				content: buildCodexConfigTemplate(),
			},
		]
	}
	if (kind === 'claude_code') {
		return [
			{
				relativePath: '.claude/agents/clawlab-research.md',
				description: 'Project-local Claude Code agent for ClawLab',
				content: buildClaudeAgentTemplate(),
			},
			{
				relativePath: '.claude/settings.local.json',
				description: 'Project-local Claude Code settings template for ClawLab',
				content: buildClaudeSettingsTemplate(),
			},
		]
	}
	return [
		{
			relativePath: '.openclaw/clawlab.project.json5',
			description: 'Project-local OpenClaw gateway example for ClawLab',
			content: buildOpenClawConfigTemplate(),
		},
		{
			relativePath: '.openclaw/README.md',
			description: 'Project-local OpenClaw integration notes for ClawLab',
			content: buildOpenClawReadmeTemplate(),
		},
	]
}
