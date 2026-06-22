import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { classifyAndSave, sendTelegram } from '@/lib/chum'

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
      // จำแนกและบันทึก
      const { label } = await classifyAndSave(text)

      // ตอบกลับ LINE
      await replyLine(replyToken, `✅ บันทึกแล้วใน ${label}`)

      // แจ้ง Telegram
      await sendTelegram(
        `🤖 <b>CHUM-OS รับข้อความใหม่</b>\n\n📝 ${text}\n\n📂 บันทึกใน: ${label}`
      )
    } catch (err) {
      console.error('Error:', err)
      await replyLine(replyToken, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะครับ')
    }
  }

  return NextResponse.json({ ok: true })
}
