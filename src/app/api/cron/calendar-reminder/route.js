import { NextResponse } from 'next/server'
import { getTodayEvents, formatEvents } from '@/lib/google-calendar'
import { sendTelegram } from '@/lib/chum'

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const events = await getTodayEvents()
    const text = formatEvents(events)
    await sendTelegram(`🌅 <b>สวัสดีตอนเช้า! ตารางวันนี้</b>\n\n${text}`)

    return NextResponse.json({ ok: true, notified: events.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
