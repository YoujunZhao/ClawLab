// scripts/test-auth.ts
// Quick test that the API key is configured and can reach Anthropic
// Usage: bun scripts/test-auth.ts

import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY

if (!apiKey) {
	console.log('SKIP: ANTHROPIC_API_KEY is not set; skipping auth connectivity test.')
	process.exit(0)
}

const client = new Anthropic({ apiKey })

async function main() {
	try {
		const msg = await client.messages.create({
			model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
			max_tokens: 50,
			messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
		})
		console.log('✅ API connection successful!')
		console.log('Response:', msg.content[0].type === 'text' ? msg.content[0].text : msg.content[0])
	} catch (err: any) {
		console.error('❌ API connection failed:', err.message)
		process.exit(1)
	}
}

main()
