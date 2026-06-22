import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const STATS_TITLE = '__chum_os_stats__'

// Haiku pricing (per million tokens)
const INPUT_COST_PER_M = 0.80
const OUTPUT_COST_PER_M = 4.00

async function findOrCreateStatsPage() {
  const parentId = process.env.NOTION_INBOX_PAGE_ID
  const res = await notion.blocks.children.list({ block_id: parentId, page_size: 100 })
  const existing = res.results.find(
    b => b.type === 'child_page' && b.child_page.title === STATS_TITLE
  )
  if (existing) return existing.id

  const page = await notion.pages.create({
    parent: { page_id: parentId },
    properties: { title: { title: [{ text: { content: STATS_TITLE } }] } },
    children: [{
      object: 'block',
      type: 'code',
      code: {
        language: 'json',
        rich_text: [{ type: 'text', text: { content: JSON.stringify({ input: 0, output: 0, calls: 0 }) } }]
      }
    }]
  })
  return page.id
}

async function readStats(pageId) {
  const res = await notion.blocks.children.list({ block_id: pageId })
  const codeBlock = res.results.find(b => b.type === 'code')
  if (!codeBlock) return { input: 0, output: 0, calls: 0 }
  try {
    return JSON.parse(codeBlock.code.rich_text[0]?.plain_text || '{}')
  } catch {
    return { input: 0, output: 0, calls: 0 }
  }
}

async function writeStats(pageId, stats) {
  const res = await notion.blocks.children.list({ block_id: pageId })
  const codeBlock = res.results.find(b => b.type === 'code')
  if (!codeBlock) return
  await notion.blocks.update(codeBlock.id, {
    code: {
      language: 'json',
      rich_text: [{ type: 'text', text: { content: JSON.stringify(stats) } }]
    }
  })
}

export async function addUsage(inputTokens, outputTokens) {
  try {
    const pageId = await findOrCreateStatsPage()
    const current = await readStats(pageId)
    await writeStats(pageId, {
      input: (current.input || 0) + inputTokens,
      output: (current.output || 0) + outputTokens,
      calls: (current.calls || 0) + 1,
    })
  } catch (err) {
    console.error('usage-tracker error:', err.message)
  }
}

export async function getUsageStats() {
  try {
    const pageId = await findOrCreateStatsPage()
    const stats = await readStats(pageId)
    const inputCost = ((stats.input || 0) / 1_000_000) * INPUT_COST_PER_M
    const outputCost = ((stats.output || 0) / 1_000_000) * OUTPUT_COST_PER_M
    return {
      inputTokens: stats.input || 0,
      outputTokens: stats.output || 0,
      totalTokens: (stats.input || 0) + (stats.output || 0),
      calls: stats.calls || 0,
      costUSD: parseFloat((inputCost + outputCost).toFixed(4)),
    }
  } catch {
    return null
  }
}
