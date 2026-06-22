import { NextResponse } from 'next/server'
import { classifyAndSave, sendTelegram } from '@/lib/chum'

export async function POST(request) {
  const body = await request.json()
  const message = body.message

  if (!message || !message.text) {
    return NextResponse.json({ ok: true })
  }

  // รับเฉพาะข้อความจาก Chat ID ของอาจารย์
  if (String(message.chat.id) !== process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ ok: true })
  }

  const text = message.text

  try {
    const { label } = await classifyAndSave(text)
    await sendTelegram(`✅ บันทึกแล้วใน ${label}\n\n📝 "${text}"`)
  } catch (err) {
    console.error('Error:', err)
    await sendTelegram('❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะครับ')
  }

  return NextResponse.json({ ok: true })
}
