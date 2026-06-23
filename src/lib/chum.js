import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@notionhq/client'
import { addUsage } from '@/lib/usage-tracker'
import { createCalendarEvent } from '@/lib/google-calendar'

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

function toISO(dateStr) {
  if (!dateStr) return null
  // แปลง พ.ศ. → ค.ศ. และ format ต่างๆ
  const cleaned = dateStr.trim()
    .replace(/(\d{4})/g, m => parseInt(m) > 2400 ? String(parseInt(m) - 543) : m)
    .replace(/[\/\.]/g, '-')
  // dd-mm-yyyy หรือ d-m-yyyy
  const match = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (match) return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10)
  return null
}

export async function classifyAndSave(text) {
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

  // ให้ Claude จำแนกและแยก fields พร้อมกัน รองรับหลาย events
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `วิเคราะห์ข้อความนี้แล้วตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น

ถ้ามีหลาย event/กิจกรรม ให้ตอบเป็น array ถ้ามีแค่ 1 ให้ตอบเป็น object เดียว:

{
  "category": "inbox|tasks|workout|content|income",
  "task": "ชื่องาน/หัวข้อสั้นๆ",
  "date": "dd/mm/yyyy หรือ null",
  "start_time": "HH:MM หรือ null",
  "end_time": "HH:MM หรือ null",
  "description": "รายละเอียด หรือ null",
  "location": "สถานที่ หรือ null"
}

กฎ category:
- tasks = งาน ประชุม อบรม กิจกรรม ส่งเอกสาร deadline นัดหมาย ทุกอย่างที่มีวันที่/เวลา
- workout = ออกกำลังกาย อาหาร น้ำหนัก สุขภาพ
- content = คลิป วิดีโอ ไอเดียคอนเทนต์ YouTube TikTok
- income = รายได้เสริม affiliate course ขายของ
- inbox = อื่นๆ ที่ไม่ใช่หมวดข้างบน

หมายเหตุ: แปลง พ.ศ.→ค.ศ. โดยลบ 543 (เช่น 2569→2026, 69→2026)
วันนี้คือ ${todayISO} (ค.ศ.)

ข้อความ: "${text}"`
    }]
  })

  addUsage(response.usage.input_tokens, response.usage.output_tokens).catch(() => {})

  let items = []
  try {
    const raw = response.content[0].text
    const jsonMatch = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      items = Array.isArray(parsed) ? parsed : [parsed]
    }
  } catch {}

  if (items.length === 0) items = [{}]

  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })
  let lastCategory = 'inbox'

  for (const parsed of items) {
    const category = parsed.category && PAGE_MAP[parsed.category] ? parsed.category : 'inbox'
    lastCategory = category
    const pageId = PAGE_MAP[category]
    const isDatabase = category === 'tasks'

    const dateISO = toISO(parsed.date) || todayISO
    const taskTitle = parsed.task || text.slice(0, 100)
    const description = [parsed.description, parsed.location].filter(Boolean).join(' · ') || null

    const startDateTime = parsed.start_time ? `${dateISO}T${parsed.start_time}:00+07:00` : dateISO
    const endDateTime = parsed.end_time ? `${dateISO}T${parsed.end_time}:00+07:00` : null

    const dateProperty = endDateTime
      ? { date: { start: startDateTime, end: endDateTime } }
      : { date: { start: startDateTime } }

    const properties = isDatabase
      ? {
          Task: { title: [{ text: { content: taskTitle } }] },
          Date: dateProperty,
          ...(description && { Description: { rich_text: [{ text: { content: description } }] } }),
        }
      : {
          title: { title: [{ text: { content: text.slice(0, 100) } }] },
        }

    await notion.pages.create({
      parent: isDatabase ? { database_id: pageId } : { page_id: pageId },
      icon: isDatabase ? { type: 'emoji', emoji: '✅' } : undefined,
      properties,
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: `📌 ${text}\n\n🕐 ${now} · จาก LINE Bot` } }] }
      }]
    })

    if (isDatabase && parsed.date) {
      const calEnd = endDateTime || new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString()
      createCalendarEvent(taskTitle, startDateTime, calEnd, description || text).catch(() => {})
    }
  }

  const category = lastCategory
  return { category, label: CATEGORY_LABELS[category] }
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
