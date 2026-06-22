import { NextResponse } from 'next/server'
import { getUpcomingEvents, formatEvents } from '@/lib/google-calendar'
import { sendTelegram } from '@/lib/chum'

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const events = await getUpcomingEvents(30)
    if (events.length === 0) return NextResponse.json({ ok: true, message: 'no upcoming events' })

    const text = formatEvents(events)
    await sendTelegram(`🔔 <b>แจ้งเตือน Calendar</b>\n\nมีกำหนดการใน 30 นาทีข้างหน้า:\n\n${text}`)

    return NextResponse.json({ ok: true, notified: events.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
