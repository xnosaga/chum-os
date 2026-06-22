'use client'
import { useEffect, useState } from 'react'

const STATUS_LABELS = {
  line: 'LINE',
  telegram: 'Telegram',
  notion: 'Notion',
  calendar: 'Google Calendar',
  anthropic: 'Claude AI',
}

const CATEGORY_COLORS = {
  inbox:   '#6B7280',
  tasks:   '#10B981',
  workout: '#F59E0B',
  content: '#8B5CF6',
  income:  '#EF4444',
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'เมื่อกี้'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return `${Math.floor(h / 24)} วันที่แล้ว`
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok'
  })
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)

  async function fetchData() {
    try {
      const res = await fetch('/api/dashboard')
      const json = await res.json()
      setData(json)
      setLastRefresh(new Date())
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [])

  const total = data?.stats?.reduce((sum, s) => sum + s.count, 0) ?? 0

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#fff', minHeight: '100vh', color: '#1a1a1a' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #e5e5e5', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '600', letterSpacing: '-0.3px' }}>CHUM-OS</h1>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#888' }}>AI Personal Assistant Dashboard</p>
        </div>
        <div style={{ fontSize: '12px', color: '#aaa' }}>
          {lastRefresh ? `อัปเดต ${lastRefresh.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}
          <button onClick={fetchData} style={{ marginLeft: '10px', background: 'none', border: '1px solid #e5e5e5', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: '#555' }}>↻ รีเฟรช</button>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#aaa', padding: '80px 0', fontSize: '14px' }}>กำลังโหลด...</div>
        ) : (
          <>
            {/* System Status */}
            <section style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>สถานะระบบ</h2>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {data?.status && Object.entries(data.status).map(([key, ok]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', border: '1px solid #e5e5e5', borderRadius: '20px', fontSize: '13px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
                    {STATUS_LABELS[key]}
                  </div>
                ))}
              </div>
            </section>

            {/* Claude API Usage */}
            {data?.usage && (
              <section style={{ marginBottom: '40px' }}>
                <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>Claude API Usage</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
                  {[
                    { label: 'คำขอทั้งหมด', value: data.usage.calls.toLocaleString(), unit: 'calls' },
                    { label: 'Input tokens', value: data.usage.inputTokens.toLocaleString(), unit: 'tokens' },
                    { label: 'Output tokens', value: data.usage.outputTokens.toLocaleString(), unit: 'tokens' },
                    { label: 'ค่าใช้จ่ายประมาณ', value: `$${data.usage.costUSD}`, unit: 'USD' },
                  ].map(item => (
                    <div key={item.label} style={{ border: '1px solid #e5e5e5', borderRadius: '10px', padding: '16px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px' }}>{item.value}</div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{item.label}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '11px', color: '#bbb', margin: '8px 0 0' }}>Haiku: $0.80/M input · $4.00/M output · สะสมตั้งแต่เริ่มใช้</p>
              </section>
            )}

            {/* Stats */}
            <section style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>สถิติรายหมวดหมู่</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
                {data?.stats?.map(s => (
                  <div key={s.key} style={{ border: '1px solid #e5e5e5', borderRadius: '10px', padding: '16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: CATEGORY_COLORS[s.key] }}>{s.count}</div>
                    <div style={{ fontSize: '13px', color: '#555', marginTop: '4px' }}>{s.label}</div>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: '#f5f5f5' }}>
                      <div style={{ height: '100%', width: `${total ? (s.count / total) * 100 : 0}%`, background: CATEGORY_COLORS[s.key], transition: 'width 0.5s' }} />
                    </div>
                  </div>
                ))}
                <div style={{ border: '1px solid #e5e5e5', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '24px', fontWeight: '700' }}>{total}</div>
                  <div style={{ fontSize: '13px', color: '#555', marginTop: '4px' }}>📊 ทั้งหมด</div>
                </div>
              </div>
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
              {/* Calendar */}
              <section>
                <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>📅 ตารางวันนี้</h2>
                <div style={{ border: '1px solid #e5e5e5', borderRadius: '10px', overflow: 'hidden' }}>
                  {data?.calendarEvents?.length ? data.calendarEvents.map((ev, i) => (
                    <div key={i} style={{ padding: '12px 16px', borderBottom: i < data.calendarEvents.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '12px', color: '#aaa', whiteSpace: 'nowrap', paddingTop: '1px' }}>
                        {ev.start?.dateTime ? formatTime(ev.start.dateTime) : 'ทั้งวัน'}
                      </div>
                      <div style={{ fontSize: '14px', color: '#1a1a1a' }}>{ev.summary}</div>
                    </div>
                  )) : (
                    <div style={{ padding: '24px 16px', fontSize: '14px', color: '#aaa', textAlign: 'center' }}>ไม่มีกำหนดการวันนี้</div>
                  )}
                </div>
              </section>

              {/* Recent Logs */}
              <section>
                <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>🕐 บันทึกล่าสุด</h2>
                <div style={{ border: '1px solid #e5e5e5', borderRadius: '10px', overflow: 'hidden' }}>
                  {data?.logs?.length ? data.logs.map((log, i) => (
                    <div key={i} style={{ padding: '10px 16px', borderBottom: i < data.logs.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
                        <span style={{ fontSize: '11px', background: CATEGORY_COLORS[log.category] + '18', color: CATEGORY_COLORS[log.category], padding: '1px 7px', borderRadius: '10px', fontWeight: '500' }}>
                          {log.label}
                        </span>
                        <span style={{ fontSize: '11px', color: '#aaa' }}>{timeAgo(log.created)}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.title}</div>
                    </div>
                  )) : (
                    <div style={{ padding: '24px 16px', fontSize: '14px', color: '#aaa', textAlign: 'center' }}>ยังไม่มีบันทึก</div>
                  )}
                </div>
              </section>
            </div>

            <p style={{ marginTop: '40px', fontSize: '12px', color: '#ccc', textAlign: 'center' }}>
              CHUM-OS • LINE & Telegram Bot • Powered by Claude AI
            </p>
          </>
        )}
      </div>
    </div>
  )
}
