import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const PAGES = {
  inbox:   { id: process.env.NOTION_INBOX_PAGE_ID,   label: 'Inbox',   emoji: '📥' },
  tasks:   { id: process.env.NOTION_TASKS_PAGE_ID,   label: 'Tasks',   emoji: '✅' },
  workout: { id: process.env.NOTION_WORKOUT_PAGE_ID, label: 'Workout', emoji: '💪' },
  content: { id: process.env.NOTION_CONTENT_PAGE_ID, label: 'Content', emoji: '🎬' },
  income:  { id: process.env.NOTION_INCOME_PAGE_ID,  label: 'Income',  emoji: '💰' },
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
    timeZone: 'Asia/Bangkok'
  })
}

export async function searchNotion(query, limit = 8) {
  const results = []
  const q = query.toLowerCase()

  await Promise.all(
    Object.entries(PAGES).map(async ([key, page]) => {
      try {
        const res = await notion.blocks.children.list({ block_id: page.id, page_size: 100 })
        const matched = res.results.filter(b =>
          b.type === 'child_page' &&
          b.child_page.title !== '__chum_os_stats__' &&
          b.child_page.title.toLowerCase().includes(q)
        )
        for (const b of matched) {
          results.push({
            title: b.child_page.title,
            category: page.label,
            emoji: page.emoji,
            date: formatDate(b.created_time),
            created: b.created_time,
          })
        }
      } catch {}
    })
  )

  return results
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, limit)
}
