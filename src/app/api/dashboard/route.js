import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { getTodayEvents, formatEvents } from '@/lib/google-calendar'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const PAGES = {
  inbox:   { id: process.env.NOTION_INBOX_PAGE_ID,   label: '📥 Inbox',   color: '#6B7280' },
  tasks:   { id: process.env.NOTION_TASKS_PAGE_ID,   label: '✅ Tasks',   color: '#10B981' },
  workout: { id: process.env.NOTION_WORKOUT_PAGE_ID, label: '💪 Workout', color: '#F59E0B' },
  content: { id: process.env.NOTION_CONTENT_PAGE_ID, label: '🎬 Content', color: '#8B5CF6' },
  income:  { id: process.env.NOTION_INCOME_PAGE_ID,  label: '💰 Income',  color: '#EF4444' },
}

async function getPageStats(pageId) {
  try {
    const res = await notion.blocks.children.list({ block_id: pageId, page_size: 100 })
    const pages = res.results.filter(b => b.type === 'child_page')
    return pages.length
  } catch {
    return 0
  }
}

async function getRecentLogs(limit = 10) {
  const logs = []
  for (const [key, page] of Object.entries(PAGES)) {
    try {
      const res = await notion.blocks.children.list({ block_id: page.id, page_size: 20 })
      const pages = res.results.filter(b => b.type === 'child_page')
      for (const p of pages) {
        logs.push({
          category: key,
          label: page.label,
          title: p.child_page.title,
          created: p.created_time,
        })
      }
    } catch {}
  }
  return logs
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, limit)
}

export async function GET() {
  try {
    const [stats, logs, calendarEvents] = await Promise.all([
      Promise.all(Object.entries(PAGES).map(async ([key, page]) => ({
        key, label: page.label, color: page.color,
        count: await getPageStats(page.id)
      }))),
      getRecentLogs(10),
      getTodayEvents().catch(() => []),
    ])

    const status = {
      line: !!process.env.LINE_CHANNEL_SECRET,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      notion: !!process.env.NOTION_TOKEN,
      calendar: !!process.env.GOOGLE_ACCESS_TOKEN,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    }

    return NextResponse.json({ stats, logs, calendarEvents, status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
