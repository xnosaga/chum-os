import { google } from 'googleapis'
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`
  )
}

// สร้าง URL สำหรับ login Google
export function getAuthUrl() {
  const oauth2Client = getOAuthClient()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
  })
}

// แลก code เป็น tokens แล้วบันทึกลง Notion
export async function saveTokens(code) {
  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)

  await notion.pages.create({
    parent: { page_id: process.env.NOTION_INBOX_PAGE_ID },
    properties: {
      title: { title: [{ text: { content: 'CHUM-OS Google Tokens' } }] }
    },
    children: [{
      object: 'block',
      type: 'code',
      code: {
        language: 'json',
        rich_text: [{ type: 'text', text: { content: JSON.stringify(tokens) } }]
      }
    }]
  })

  return tokens
}

// ดึง tokens จาก env (หลัง authorize แล้ว)
function getAuthenticatedClient() {
  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({
    access_token: process.env.GOOGLE_ACCESS_TOKEN,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  })
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      // auto-refresh
    }
  })
  return oauth2Client
}

// สร้าง Calendar Event จากข้อความ
export async function createCalendarEvent(title, startDateTime, endDateTime, description = '') {
  const auth = getAuthenticatedClient()
  const calendar = google.calendar({ version: 'v3', auth })

  const event = {
    summary: title,
    description,
    start: { dateTime: startDateTime, timeZone: 'Asia/Bangkok' },
    end: { dateTime: endDateTime, timeZone: 'Asia/Bangkok' },
  }

  const res = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  })

  return res.data
}

// ดึง events วันที่กำหนด (default = วันนี้)
export async function getTodayEvents(date = new Date()) {
  const auth = getAuthenticatedClient()
  const calendar = google.calendar({ version: 'v3', auth })

  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  return res.data.items || []
}

// ดึง events ที่จะเกิดใน 30 นาทีข้างหน้า
export async function getUpcomingEvents(minutesAhead = 30) {
  const auth = getAuthenticatedClient()
  const calendar = google.calendar({ version: 'v3', auth })

  const now = new Date()
  const future = new Date(now.getTime() + minutesAhead * 60 * 1000)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  return res.data.items || []
}

// format events เป็นข้อความ
export function formatEvents(events) {
  if (events.length === 0) return 'ไม่มีกำหนดการครับ'
  return events.map(e => {
    const start = e.start.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
      : 'ทั้งวัน'
    return `⏰ ${start} — ${e.summary}`
  }).join('\n')
}
