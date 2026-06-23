import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { Client } from '@notionhq/client'
import { classifyAndSave, sendTelegram } from '@/lib/chum'
import { getTodayEvents, createCalendarEvent, formatEvents } from '@/lib/google-calendar'
import { searchNotion } from '@/lib/notion-search'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

async function saveLocationToNotion(title, address, mapsUrl) {
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })
  await notion.pages.create({
    parent: { page_id: process.env.NOTION_INBOX_PAGE_ID },
    properties: {
      title: { title: [{ text: { content: `📍 ${title}` } }] },
    },
    children: [{
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `📍 ${title}\n📌 ${address || ''}\n🗺️ ${mapsUrl}\n\n🕐 ${now} · จาก LINE` } }] }
    }]
  })
}

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

// dedup: เก็บ message IDs ล่าสุดไม่ให้บันทึกซ้ำ
const recentMessageIds = new Set()

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
    // LINE Location pin → บันทึกลง Notion Inbox พร้อม Google Maps URL
    if (event.type === 'message' && event.message.type === 'location') {
      const { title, address, latitude, longitude } = event.message
      const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`
      const label = title || address || 'สถานที่'
      await saveLocationToNotion(label, address, mapsUrl)
      await replyLine(event.replyToken, `📍 บันทึกสถานที่แล้วครับ\n\n${label}\n${mapsUrl}`)
      continue
    }

    // รูปภาพ / สติ๊กเกอร์ / ไฟล์ / เสียง
    if (event.type === 'message' && event.message.type !== 'text') {
      const typeMap = { image: 'รูปภาพ', sticker: 'สติ๊กเกอร์', file: 'ไฟล์', audio: 'เสียง', video: 'วิดีโอ' }
      const typeName = typeMap[event.message.type] || event.message.type
      await replyLine(event.replyToken, `📎 รับ${typeName}แล้วครับ แต่ยังไม่รองรับการบันทึก${typeName}\nพิมพ์ข้อความอธิบายแทนได้เลยครับ`)
      continue
    }

    if (event.type !== 'message' || event.message.type !== 'text') continue

    const text = event.message.text
    const replyToken = event.replyToken
    const messageId = event.message.id

    // dedup: ข้ามถ้าเพิ่งบันทึก message นี้ไปแล้ว
    if (recentMessageIds.has(messageId)) continue
    recentMessageIds.add(messageId)
    if (recentMessageIds.size > 100) {
      const first = recentMessageIds.values().next().value
      recentMessageIds.delete(first)
    }

    try {
      const lowerText = text.trim().toLowerCase()

      // คำสั่ง: วิธีใช้
      if (lowerText === 'วิธีใช้' || lowerText === 'help' || lowerText === '?') {
        await replyLine(replyToken, `🤖 CHUM-OS — คำสั่งที่ใช้ได้\n\n📝 พิมพ์ข้อความทั่วไป → บันทึกลง Notion อัตโนมัติ\n\n📅 ตารางวันนี้ → ดู Calendar\n\n🔍 ค้นหา: [คำ] → ค้นหาใน Notion\n   ตัวอย่าง: ค้นหา: ประชุม\n\n📆 สร้าง event:\n   ตัวอย่าง: ประชุม 25/6 14:00\n   ตัวอย่าง: พรุ่งนี้ 10:30 ส่งรายงาน`)
        return NextResponse.json({ ok: true })
      }

      // คำสั่ง: ค้นหา Notion
      const searchMatch = text.match(/^(?:ค้นหา|search|หา)[:\s]*(.*)$/i)
      if (searchMatch) {
        const query = searchMatch[1].trim()
        if (!query) {
          await replyLine(replyToken, '🔍 พิมพ์คำที่ต้องการค้นหา\nตัวอย่าง: ค้นหา: ประชุม')
          return NextResponse.json({ ok: true })
        }
        const results = await searchNotion(query)
        if (results.length === 0) {
          await replyLine(replyToken, `🔍 ไม่พบผลลัพธ์สำหรับ "${query}"`)
        } else {
          const lines = results.map((r, i) => `${i + 1}. ${r.emoji} ${r.title}\n   📂 ${r.category} · ${r.date}`).join('\n\n')
          await replyLine(replyToken, `🔍 ผลการค้นหา "${query}" (${results.length} รายการ)\n\n${lines}`)
        }
        return NextResponse.json({ ok: true })
      }

      // คำสั่ง: ดูตาราง
      const isToday = lowerText === 'วันนี้' || lowerText.includes('ตารางวันนี้') || lowerText.includes('กำหนดการวันนี้') || lowerText.includes('วันนี้มีอะไร') || lowerText.includes('มีอะไรวันนี้')
      const isTomorrow = lowerText === 'พรุ่งนี้' || lowerText.includes('พรุ่งนี้มีอะไร') || lowerText.includes('มีอะไรพรุ่งนี้') || lowerText.includes('ตารางพรุ่งนี้')
      if (isToday || isTomorrow) {
        const targetDate = isTomorrow ? new Date(Date.now() + 86400000) : new Date()
        const events = await getTodayEvents(targetDate)
        const label = isTomorrow ? 'พรุ่งนี้' : 'วันนี้'
        const reply = `📅 ตาราง${label}\n\n${formatEvents(events)}`
        await replyLine(replyToken, reply)
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
