import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@notionhq/client'
import { addUsage } from '@/lib/usage-tracker'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const notion = new Client({ auth: process.env.NOTION_TOKEN })

// Page IDs map
const PAGE_MAP = {
  inbox:   process.env.NOTION_INBOX_PAGE_ID,
  tasks:   process.env.NOTION_TASKS_PAGE_ID,
  workout: process.env.NOTION_WORKOUT_PAGE_ID,
  content: process.env.NOTION_CONTENT_PAGE_ID,
  income:  process.env.NOTION_INCOME_PAGE_ID,
}

// ประเภทและ label ภาษาไทย
const CATEGORY_LABELS = {
  inbox:   '📥 In BOX',
  tasks:   '✅ Tasks',
  workout: '💪 Workout + Diet',
  content: '🎬 Content Creator',
  income:  '💰 Second Income',
}

export async function classifyAndSave(text) {
  // 1. ให้ Claude จำแนกประเภท
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `จำแนกข้อความนี้เป็น 1 ประเภทเท่านั้น ตอบแค่คำเดียว: inbox / tasks / workout / content / income

กฎ:
- tasks = งาน ประชุม ส่งเอกสาร deadline
- workout = ออกกำลังกาย อาหาร น้ำหนัก สุขภาพ
- content = คลิป วิดีโอ ไอเดียคอนเทนต์ YouTube TikTok
- income = รายได้เสริม affiliate course ขายของ
- inbox = อื่นๆ ไม่แน่ใจ

ข้อความ: "${text}"`
    }]
  })

  addUsage(response.usage.input_tokens, response.usage.output_tokens).catch(() => {})

  const category = response.content[0].text.trim().toLowerCase()
  const validCategory = PAGE_MAP[category] ? category : 'inbox'
  const pageId = PAGE_MAP[validCategory]

  // 2. บันทึกลง Notion
  const now = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  })
  const todayISO = new Date().toISOString().slice(0, 10)

  const isDatabase = validCategory === 'tasks'

  await notion.pages.create({
    parent: isDatabase
      ? { database_id: pageId }
      : { page_id: pageId },
    properties: isDatabase
      ? {
          Name: { title: [{ text: { content: text.slice(0, 100) } }] },
          Date: { date: { start: todayISO } },
        }
      : {
          title: { title: [{ text: { content: text.slice(0, 100) } }] },
        },
    children: [{
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `📌 ${text}\n\n🕐 ${now} · จาก LINE Bot` }
        }]
      }
    }]
  })

  return {
    category: validCategory,
    label: CATEGORY_LABELS[validCategory],
  }
}

// ส่ง Telegram notification
export async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    })
  })
}
