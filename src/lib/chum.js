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
  const cleaned = dateStr.trim()
    .replace(/(\d{4})/g, m => parseInt(m) > 2400 ? String(parseInt(m) - 543) : m)
    .replace(/[\/\.]/g, '-')
  // yyyy-mm-dd (Claude return แบบนี้โดยตรง)
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10)
  // dd-mm-yyyy
  const match = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (match) return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`
  return null
}

// แปลงเวลาภาษาไทย → HH:MM
function parseThaiTime(timeStr) {
  if (!timeStr) return null
  const s = timeStr.toLowerCase().trim()
  // HH:MM or HH.MM
  const hhmm = s.match(/(\d{1,2})[:\.](\d{2})/)
  if (hhmm) {
    let h = parseInt(hhmm[1]), m = parseInt(hhmm[2])
    if (/pm|บ่าย|เย็น|ค่ำ|ทุ่ม/.test(s) && h < 12) h += 12
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  }
  // "บ่ายสาม" "สามโมงเย็น" "สี่ทุ่ม" "ตีสอง"
  const thaiNum = { 'หนึ่ง':1,'สอง':2,'สาม':3,'สี่':4,'ห้า':5,'หก':6,'เจ็ด':7,'แปด':8,'เก้า':9,'สิบ':10,'สิบเอ็ด':11,'สิบสอง':12 }
  for (const [word, num] of Object.entries(thaiNum)) {
    if (s.includes(word)) {
      if (s.includes('ตี')) return `${String(num).padStart(2,'0')}:00`
      if (s.includes('เช้า') || s.includes('โมงเช้า')) return num < 7 ? `0${num}:00` : `${num}:00`
      if (s.includes('บ่าย')) return `${num + 12}:00`
      if (s.includes('เย็น')) return num <= 6 ? `${num + 12}:00` : `${num}:00`
      if (s.includes('ทุ่ม')) return `${num + 18}:00`
      if (s.includes('โมง')) return num <= 6 ? `0${num}:00` : `${num}:00`
    }
  }
  return null
}

export async function classifyAndSave(text) {
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const now = new Date()
  // คำนวณวันในสัปดาห์นี้/หน้า
  const dayNames = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์']
  const todayDow = now.getDay()
  function nextDayISO(targetDow, nextWeek = false) {
    let diff = targetDow - todayDow
    if (diff <= 0 || nextWeek) diff += 7
    const d = new Date(now)
    d.setDate(d.getDate() + diff)
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  }
  // แทนที่วันสัมพัทธ์ใน text ก่อนส่ง Claude
  let processedText = text
  const tomorrowISO = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  processedText = processedText.replace(/พรุ่งนี้/g, `พรุ่งนี้(${tomorrowISO})`)
  processedText = processedText.replace(/วันนี้/g, `วันนี้(${todayISO})`)
  for (let i = 0; i < 7; i++) {
    const isNextWeek = processedText.includes(`วัน${dayNames[i]}หน้า`)
    if (isNextWeek) processedText = processedText.replace(`วัน${dayNames[i]}หน้า`, `วัน${dayNames[i]}หน้า(${nextDayISO(i, true)})`)
    const isThis = processedText.includes(`วัน${dayNames[i]}นี้`) || (processedText.includes(`วัน${dayNames[i]}`) && !processedText.includes('หน้า'))
    if (isThis && i !== todayDow) processedText = processedText.replace(`วัน${dayNames[i]}`, `วัน${dayNames[i]}(${nextDayISO(i, false)})`)
  }
  if (/อาทิตย์หน้า|สัปดาห์หน้า/.test(processedText)) {
    const nextSun = new Date(now); nextSun.setDate(now.getDate() + (7 - todayDow))
    processedText = processedText.replace(/อาทิตย์หน้า|สัปดาห์หน้า/g, `อาทิตย์หน้า(${nextSun.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })})`)
  }

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
  "task": "ชื่องาน/หัวข้อสั้นๆ (ไม่เกิน 80 ตัวอักษร)",
  "date": "yyyy-mm-dd หรือ null",
  "start_time": "HH:MM หรือ null (24hr)",
  "end_time": "HH:MM หรือ null (24hr)",
  "description": "รายละเอียด หรือ null",
  "location": "สถานที่ หรือ null"
}

กฎ category:
- tasks = งาน ประชุม อบรม กิจกรรม ส่งเอกสาร deadline นัดหมาย ทุกอย่างที่มีกำหนดการ
- workout = ออกกำลังกาย อาหาร น้ำหนัก สุขภาพ
- content = คลิป วิดีโอ ไอเดียคอนเทนต์ YouTube TikTok
- income = รายได้เสริม affiliate course ขายของ
- inbox = บันทึก ไอเดีย ข้อมูล หรือสิ่งที่ไม่มีกำหนดการ

กฎวันที่:
- แปลง พ.ศ.→ค.ศ. โดยลบ 543 (เช่น 2569→2026)
- วันในวงเล็บ () คือวันที่จริงในรูป yyyy-mm-dd ให้ใช้ค่านั้นได้เลย
- ถ้าไม่มีวันที่ให้ใช้ ${todayISO}

กฎเวลา:
- บ่ายสาม = 15:00, สามทุ่ม = 21:00, ตีสอง = 02:00
- เช้า/โมงเช้า = AM, บ่าย/เย็น/ทุ่ม = PM
- 9.00-12.00 → start=09:00 end=12:00

ข้อความยาวให้ดึงเฉพาะส่วนที่เป็นกำหนดการ
วันนี้คือ ${todayISO} (ค.ศ.)

ข้อความ: "${processedText.slice(0, 800)}"`
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
