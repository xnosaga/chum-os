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

  // ให้ Claude จำแนกและแยก fields พร้อมกัน
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `วิเคราะห์ข้อความนี้แล้วตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:

{
  "category": "inbox|tasks|workout|content|income",
  "task": "ชื่องาน/หัวข้อสั้นๆ",
  "date": "dd/mm/yyyy หรือ null (แปลง พ.ศ.→ค.ศ. ถ้ามี)",
  "start_time": "HH:MM หรือ null (เวลาเริ่ม 24hr format)",
  "end_time": "HH:MM หรือ null (เวลาสิ้นสุด 24hr format)",
  "description": "รายละเอียดเพิ่มเติม หรือ null",
  "location": "สถานที่ หรือ null"
}

กฎ category:
- tasks = งาน ประชุม อบรม ส่งเอกสาร deadline กิจกรรม
- workout = ออกกำลังกาย อาหาร น้ำหนัก สุขภาพ
- content = คลิป วิดีโอ ไอเดียคอนเทนต์ YouTube TikTok
- income = รายได้เสริม affiliate course ขายของ
- inbox = อื่นๆ

วันนี้คือ ${todayISO} (ค.ศ.)

ข้อความ: "${text}"`
    }]
  })

  addUsage(response.usage.input_tokens, response.usage.output_tokens).catch(() => {})

  let parsed = {}
  try {
    const json = response.content[0].text.match(/\{[\s\S]*\}/)
    parsed = json ? JSON.parse(json[0]) : {}
  } catch {}

  const category = parsed.category && PAGE_MAP[parsed.category] ? parsed.category : 'inbox'
  const pageId = PAGE_MAP[category]
  const isDatabase = category === 'tasks'

  const dateISO = toISO(parsed.date) || todayISO
  const taskTitle = parsed.task || text.slice(0, 100)
  const description = [parsed.description, parsed.location].filter(Boolean).join(' · ') || null

  const startDateTime = parsed.start_time ? `${dateISO}T${parsed.start_time}:00+07:00` : dateISO
  const endDateTime = parsed.end_time ? `${dateISO}T${parsed.end_time}:00+07:00` : null

  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })

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

  // สร้าง Google Calendar event อัตโนมัติถ้าเป็น tasks และมีวันที่
  if (isDatabase && parsed.date) {
    const calStart = startDateTime
    const calEnd = endDateTime || `${dateISO}T${parsed.start_time ? parsed.start_time : '09:00'}:00+07:00`
    const calEndFinal = endDateTime || new Date(new Date(calEnd).getTime() + 60 * 60 * 1000).toISOString()
    createCalendarEvent(
      taskTitle,
      calStart,
      calEndFinal,
      description || text
    ).catch(() => {})
  }

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
