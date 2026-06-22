import { NextResponse } from 'next/server'
import { saveTokens } from '@/lib/google-calendar'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 })
  }

  try {
    const tokens = await saveTokens(code)
    return NextResponse.json({
      ok: true,
      message: 'Google Calendar เชื่อมต่อสำเร็จ! บันทึก tokens ด้านล่างลงใน Vercel env ครับ',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
