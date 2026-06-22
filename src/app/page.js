export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>🤖 CHUM-OS Bot</h1>
      <p>ระบบ AI ช่วยงานอาจารย์ — กำลังทำงานอยู่</p>
      <ul>
        <li>LINE Webhook: <code>/api/webhook/line</code></li>
        <li>Telegram Webhook: <code>/api/webhook/telegram</code></li>
      </ul>
    </main>
  )
}
