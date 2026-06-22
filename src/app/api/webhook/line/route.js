import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { classifyAndSave, sendTelegram } from '@/lib/chum'
import { getTodayEvents, createCalendarEvent, formatEvents } from '@/lib/google-calendar'
import { searchNotion } from '@/lib/notion-search'

// ตรวจสอบ LINE signature
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64')
  return hash === signature
}

// ตอบกลับ LINE
async function replyLine(replyToken, message) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: message }]
    })
  })
}

export async function POST(request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-line-signature')

  // ตรวจสอบว่ามาจาก LINE จริง
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody)
  const events = body.events || []

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue

    const text = event.message.text
    const replyToken = event.replyToken

    try {
      const lowerText = text.trim().toLowerCase()

      // คำสั่ง: ค้นหา Notion
      const searchMatch = text.match(/^(?:ค้นหา|search|หา)[:\s]+(.+)/i)
      if (searchMatch) {
        const query = searchMatch[1].trim()
        const results = await searchNotion(query)
        if (results.length === 0) {
          await replyLine(replyToken, `🔍 ไม่พบผลลัพธ์สำหรับ "${query}"`)
        } else {
          const lines = results.map((r, i) => `${i + 1}. ${r.emoji} ${r.title}\n   📂 ${r.category} · ${r.date}`).join('\n\n')
          await replyLine(replyToken, `🔍 ผลการค้นหา "${query}" (${results.length} รายการ)\n\n${lines}`)
        }
        return NextResponse.json({ ok: true })
      }

      // คำสั่ง: ดูตารางวันนี้
      if (lowerText.includes('ตารางวันนี้') || lowerText.includes('กำหนดการวันนี้')) {
        const events = await getTodayEvents()
        const reply = `📅 <b>ตารางวันนี้</b>\n\n${formatEvents(events)}`
        await replyLine(replyToken, reply.replace(/<[^>]*>/g, ''))
        return
      }

      // detect วันเวลา → สร้าง Calendar event
      const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?.*?(\d{1,2})[:\.](\d{2})\s*(น\.?|am|pm)?/i)
      const timeMatch = !dateMatch && text.match(/(?:พรุ่งนี้|วันนี้|tomorrow|today).*?(\d{1,2})[:\.](\d{2})/i)

      if (dateMatch || timeMatch) {
        const now = new Date()
        let startDate

        if (dateMatch) {
          const day = parseInt(dateMatch[1])
          const month = parseInt(dateMatch[2]) - 1
          const year = dateMatch[3] ? (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3])) : now.getFullYear()
          const hour = parseInt(dateMatch[4])
          const minute = parseInt(dateMatch[5])
          startDate = new Date(year, month, day, hour, minute)
        } else {
          const isTomorrow = /พรุ่งนี้|tomorrow/i.test(text)
          startDate = new Date(now)
          if (isTomorrow) startDate.setDate(startDate.getDate() + 1)
          const hour = parseInt(timeMatch[1])
          const minute = parseInt(timeMatch[2])
          startDate.setHours(hour, minute, 0, 0)
        }

        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
        const event = await createCalendarEvent(text.slice(0, 100), startDate.toISOString(), endDate.toISOString(), 'สร้างจาก LINE Bot')
        await replyLine(replyToken, `📅 สร้าง Calendar event แล้วครับ\n\n"${event.summary}"\n🕐 ${startDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`)
        await sendTelegram(`📅 <b>สร้าง Calendar Event</b>\n\n📌 ${text}`)
        return
      }

      // จำแนกและบันทึกลง Notion ตามปกติ
      const { label } = await classifyAndSave(text)
      await replyLine(replyToken, `✅ บันทึกแล้วใน ${label}`)
      await sendTelegram(`🤖 <b>CHUM-OS รับข้อความใหม่</b>\n\n📝 ${text}\n\n📂 บันทึกใน: ${label}`)
    } catch (err) {
      console.error('Error:', err)
      await replyLine(replyToken, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะครับ')
    }
  }

  return NextResponse.json({ ok: true })
}
