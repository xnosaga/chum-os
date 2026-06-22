import { redirect } from 'next/navigation'
import { getAuthUrl } from '@/lib/google-calendar'

export async function GET() {
  const url = getAuthUrl()
  redirect(url)
}
