#!/usr/bin/env node
// รัน: LINE_CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-rich-menu.js
const https = require('https')
const sharp = require('sharp')

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
if (!TOKEN) {
  console.error('กรุณาตั้งค่า LINE_CHANNEL_ACCESS_TOKEN\nรัน: LINE_CHANNEL_ACCESS_TOKEN=xxx node scripts/setup-rich-menu.js')
  process.exit(1)
}

const W = 2500, H = 843, COL = Math.floor(W / 3)

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>

  <rect x="0" y="0" width="${COL}" height="${H}" fill="#EFF6FF"/>
  <rect x="0" y="0" width="6" height="${H}" fill="#3B82F6"/>
  <text x="${COL * 0.5}" y="380" text-anchor="middle" font-size="200" font-family="Arial">&#128197;</text>
  <text x="${COL * 0.5}" y="570" text-anchor="middle" font-size="80" font-family="Arial" fill="#1D4ED8" font-weight="bold">Today</text>
  <text x="${COL * 0.5}" y="660" text-anchor="middle" font-size="64" font-family="Arial" fill="#6B7280">Calendar</text>

  <rect x="${COL}" y="0" width="${COL}" height="${H}" fill="#F0FDF4"/>
  <rect x="${COL}" y="40" width="2" height="${H - 80}" fill="#D1FAE5"/>
  <text x="${COL * 1.5}" y="380" text-anchor="middle" font-size="200" font-family="Arial">&#128269;</text>
  <text x="${COL * 1.5}" y="570" text-anchor="middle" font-size="80" font-family="Arial" fill="#15803D" font-weight="bold">Search</text>
  <text x="${COL * 1.5}" y="660" text-anchor="middle" font-size="64" font-family="Arial" fill="#6B7280">Notion</text>

  <rect x="${COL * 2}" y="0" width="${COL}" height="${H}" fill="#F9FAFB"/>
  <rect x="${COL * 2}" y="40" width="2" height="${H - 80}" fill="#E5E7EB"/>
  <text x="${COL * 2.5}" y="380" text-anchor="middle" font-size="200" font-family="Arial">&#128202;</text>
  <text x="${COL * 2.5}" y="570" text-anchor="middle" font-size="80" font-family="Arial" fill="#374151" font-weight="bold">Dashboard</text>
  <text x="${COL * 2.5}" y="660" text-anchor="middle" font-size="64" font-family="Arial" fill="#6B7280">chum-os</text>

  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="#E5E7EB"/>
</svg>`

function callLineAPI(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'api.line.me',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      }
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => resolve(JSON.parse(raw || '{}')))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

function uploadImage(richMenuId, pngBuffer) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api-data.line.me',
      path: `/v2/bot/richmenu/${richMenuId}/content`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'image/png',
        'Content-Length': pngBuffer.length,
      }
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => resolve(raw))
    })
    req.on('error', reject)
    req.write(pngBuffer)
    req.end()
  })
}

async function main() {
  console.log('🎨 สร้าง Rich Menu image...')
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()
  console.log(`   ✓ PNG: ${(pngBuffer.length / 1024).toFixed(0)} KB`)

  const existing = await callLineAPI('GET', '/v2/bot/richmenu/list')
  for (const rm of (existing.richmenus || [])) {
    await callLineAPI('DELETE', `/v2/bot/richmenu/${rm.richMenuId}`)
    console.log(`   ✓ ลบ rich menu เก่า: ${rm.richMenuId}`)
  }

  console.log('📋 สร้าง Rich Menu...')
  const richMenu = {
    size: { width: W, height: H },
    selected: true,
    name: 'CHUM-OS Menu',
    chatBarText: 'เมนู',
    areas: [
      {
        bounds: { x: 0, y: 0, width: COL, height: H },
        action: { type: 'message', label: 'ตารางวันนี้', text: 'ตารางวันนี้' }
      },
      {
        bounds: { x: COL, y: 0, width: COL, height: H },
        action: { type: 'message', label: 'ค้นหา', text: 'ค้นหา: ' }
      },
      {
        bounds: { x: COL * 2, y: 0, width: COL + 1, height: H },
        action: { type: 'uri', label: 'Dashboard', uri: 'https://chum-os-eta.vercel.app' }
      },
    ]
  }

  const created = await callLineAPI('POST', '/v2/bot/richmenu', richMenu)
  if (!created.richMenuId) {
    console.error('❌ สร้าง rich menu ไม่สำเร็จ:', JSON.stringify(created))
    process.exit(1)
  }
  console.log(`   ✓ Rich Menu ID: ${created.richMenuId}`)

  console.log('🖼️  อัปโหลดรูปภาพ...')
  await uploadImage(created.richMenuId, pngBuffer)
  console.log('   ✓ อัปโหลดสำเร็จ')

  console.log('🔗 ตั้งเป็น default...')
  await callLineAPI('POST', `/v2/bot/richmenu/default/${created.richMenuId}`)
  console.log('   ✓ ตั้งค่าสำเร็จ')

  console.log('\n✅ LINE Rich Menu พร้อมใช้งาน!')
  console.log('   📅 Today Calendar → ส่ง "ตารางวันนี้"')
  console.log('   🔍 Search Notion  → ส่ง "ค้นหา: " (แล้วพิมพ์คำค้นหาต่อ)')
  console.log('   📊 Dashboard      → เปิดเว็บ chum-os-eta.vercel.app')
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
