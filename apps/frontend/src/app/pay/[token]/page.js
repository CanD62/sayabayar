'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import LogoIcon from '@/components/LogoIcon'
import QRCode from 'qrcode'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

const CHANNEL_META = {
  bca_transfer: { name: 'BCA Transfer', short: 'BCA', color: '#003d79', bg: '#e8f0fb', emoji: '🏦' },
  qris: { name: 'QRIS', short: 'QRIS', color: '#00aed6', bg: '#e5f8fd', emoji: '📱' },
  qris_bca: { name: 'QRIS', short: 'QRIS', color: '#003d79', bg: '#e8f0fb', emoji: '📱' },
  qris_gopay: { name: 'QRIS', short: 'QRIS', color: '#00aed6', bg: '#e5f8fd', emoji: '📱' },
  qris_bri: { name: 'QRIS', short: 'QRIS', color: '#003087', bg: '#e6ecf8', emoji: '📱' },
  mandiri_transfer: { name: 'Mandiri', short: 'Mandiri', color: '#003087', bg: '#e6ecf8', emoji: '🏦' },
  bri_transfer: { name: 'BRI Transfer', short: 'BRI', color: '#003087', bg: '#e6ecf8', emoji: '🏦' },
}

function getMeta(type) {
  return CHANNEL_META[type] || { name: type, short: type, color: '#6366f1', bg: '#eef2ff', emoji: '💳' }
}

// ─── QRIS Generator (ported from qrisPayment.js) ───────────────────────────

function crc16(str) {
  let crc = 0xFFFF
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1
    }
  }
  crc &= 0xFFFF
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function generateQrisString(qrisData, nominal) {
  if (!qrisData || isNaN(nominal)) return null
  const nominalStr = nominal.toString()
  const qris = qrisData.slice(0, -4)
  const step1 = qris.replace('010211', '010212')
  const step2 = step1.split('5802ID')
  const uang = `54${nominalStr.length.toString().padStart(2, '0')}${nominalStr}5802ID`
  const fix = `${step2[0].trim()}${uang}${step2[1].trim()}`
  return fix + crc16(fix)
}

// ─── QR Code Display Component ─────────────────────────────────────────────

function QRCodeDisplay({ qrisData, nominal, merchantName }) {
  const canvasRef = useRef(null)
  const [dataUrl, setDataUrl] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const qrisStr = generateQrisString(qrisData, nominal)
    if (!qrisStr) { setLoading(false); return }

    QRCode.toDataURL(qrisStr, {
      width: 280,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    }).then(url => {
      setDataUrl(url)
      setLoading(false)
      // Also draw to canvas for download
      if (canvasRef.current) {
        QRCode.toCanvas(canvasRef.current, qrisStr, {
          width: 400, margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        })
      }
    }).catch(() => setLoading(false))
  }, [qrisData, nominal])

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `QRIS-${merchantName || 'Bayar'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [merchantName])

  return (
    <div className="pay2-qr-wrap">
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {loading ? (
        <div className="pay2-qr-loading">
          <div className="pay2-mini-spin" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <span>Membuat QR Code…</span>
        </div>
      ) : dataUrl ? (
        <>
          <div className="pay2-qr-box">
            <img src={dataUrl} alt="QRIS QR Code" className="pay2-qr-img" />
            <div className="pay2-qr-scanline" />
            <div className="pay2-qr-corner tl" />
            <div className="pay2-qr-corner tr" />
            <div className="pay2-qr-corner bl" />
            <div className="pay2-qr-corner br" />
          </div>
          <div className="pay2-qr-hint">Scan dengan aplikasi dompet digital Anda</div>
          <button className="pay2-qr-download" onClick={handleDownload}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Unduh QR Code
          </button>
        </>
      ) : (
        <div className="pay2-qr-loading">
          <span style={{ fontSize: '1.5rem' }}>⚠️</span>
          <span>QR Code tidak tersedia</span>
        </div>
      )}
    </div>
  )
}

// ─── Small reusable components ─────────────────────────────────────────────

function Logo() {
  return (
    <div className="pay2-logo">
      <div className="pay2-logo-mark">
        <LogoIcon size={20} />
      </div>
      <span className="pay2-logo-text">Saya<strong>Bayar</strong></span>
    </div>
  )
}

function StepBar({ step }) {
  return (
    <div className="pay2-stepbar">
      <div className={`pay2-stepbar-item ${step >= 1 ? 'done' : ''} ${step === 1 ? 'active' : ''}`}>
        <div className="pay2-stepbar-dot">{step > 1 ? '✓' : '1'}</div>
        <span>Metode</span>
      </div>
      <div className={`pay2-stepbar-line ${step >= 2 ? 'done' : ''}`} />
      <div className={`pay2-stepbar-item ${step >= 2 ? 'active' : ''}`}>
        <div className="pay2-stepbar-dot">2</div>
        <span>Transfer</span>
      </div>
    </div>
  )
}

function Countdown({ invoice, status, onExpired }) {
  const [text, setText] = useState('')
  const [urgent, setUrgent] = useState(false)

  useEffect(() => {
    if (!invoice?.expired_at) return
    const tick = () => {
      const diff = new Date(invoice.expired_at) - Date.now()
      if (diff <= 0) { onExpired?.(); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setUrgent(diff < 300000)
      setText(h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [invoice])

  if (!text || status === 'paid' || status === 'expired' || status === 'cancelled') return null

  return (
    <div className={`pay2-countdown ${urgent ? 'urgent' : ''}`}>
      <span className="pay2-countdown-icon">{urgent ? '🔴' : '⏳'}</span>
      <span>Bayar dalam <strong>{text}</strong></span>
    </div>
  )
}

function MerchantInfo({ invoice }) {
  const initials = invoice.merchant_name?.charAt(0).toUpperCase() || '?'
  return (
    <div className="pay2-merchant">
      <div className="pay2-merchant-avatar">{initials}</div>
      <div className="pay2-merchant-body">
        <div className="pay2-merchant-label">Ditagih oleh</div>
        <div className="pay2-merchant-name">{invoice.merchant_name}</div>
      </div>
    </div>
  )
}

function AmountBadge({ amount, uniqueCode, onClick, copied }) {
  const total = amount + (uniqueCode || 0)
  return (
    <button className="pay2-amount-badge" onClick={onClick} title="Tap untuk menyalin nominal">
      <div className="pay2-amount-curr">Rp</div>
      <div className="pay2-amount-num">{fmt(total)}</div>
      <div className="pay2-amount-copy">
        {copied ? <span className="pay2-copied">✓ Disalin!</span> : <span className="pay2-copy-hint">Tap untuk salin</span>}
      </div>
    </button>
  )
}

function InfoRow({ label, value, mono, copyValue, onCopy, copied, highlight }) {
  return (
    <div className={`pay2-info-row ${copyValue ? 'copyable' : ''} ${highlight ? 'highlight' : ''}`}
      onClick={copyValue ? onCopy : undefined}
      style={{ cursor: copyValue ? 'pointer' : 'default' }}>
      <span className="pay2-info-label">{label}</span>
      <span className={`pay2-info-value ${mono ? 'mono' : ''}`}>
        {value}
        {copyValue && (
          <span className="pay2-copy-icon">{copied ? '✓' : '⎘'}</span>
        )}
      </span>
    </div>
  )
}

function CustomerCard({ invoice }) {
  if (!invoice.customer_name && !invoice.customer_email) return null
  return (
    <div className="pay2-customer">
      <div className="pay2-customer-icon">👤</div>
      <div>
        <div className="pay2-customer-label">Tagihan Kepada</div>
        {invoice.customer_name && <div className="pay2-customer-name">{invoice.customer_name}</div>}
        {invoice.customer_email && <div className="pay2-customer-email">{invoice.customer_email}</div>}
      </div>
    </div>
  )
}

// ─── Channel Owner Disclaimer ───────────────────────────────────────────────

function OwnerDisclaimer({ channelOwner }) {
  if (!channelOwner) return null
  const isClient = channelOwner === 'client'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '10px 14px',
      borderRadius: 10,
      background: isClient ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)',
      border: `1px solid ${isClient ? 'rgba(16,185,129,0.18)' : 'rgba(245,158,11,0.18)'}`,
      marginBottom: 12,
    }}>
      <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: 1 }}>
        {isClient ? '🏦' : '🔄'}
      </span>
      <span style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>
        {isClient
          ? <>Transfer dikirim <strong style={{ color: 'rgba(255,255,255,0.8)' }}>langsung ke rekening penjual</strong>. SayaBayar hanya memverifikasi pembayaran secara otomatis.</>
          : <>Pembayaran diterima oleh <strong style={{ color: 'rgba(255,255,255,0.8)' }}>SayaBayar sebagai perantara</strong>, dan akan diteruskan ke penjual.</>}
      </span>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

const REDIRECT_SECONDS = 5

function PaidScreen({ invoice }) {
  const isSub = invoice?.invoice_number?.startsWith('SUB-')
  const redirectUrl = invoice?.redirect_url
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS)
  const [redirecting, setRedirecting] = useState(false)

  const buildRedirectUrl = useCallback(() => {
    if (!redirectUrl) return null
    try {
      const url = new URL(redirectUrl)
      url.searchParams.set('invoice_number', invoice.invoice_number || '')
      url.searchParams.set('status', 'paid')
      url.searchParams.set('amount', String(invoice.amount || 0))
      return url.toString()
    } catch {
      // Invalid URL — append as query string manually
      const sep = redirectUrl.includes('?') ? '&' : '?'
      return `${redirectUrl}${sep}invoice_number=${encodeURIComponent(invoice.invoice_number || '')}&status=paid&amount=${invoice.amount || 0}`
    }
  }, [redirectUrl, invoice])

  const handleRedirect = useCallback(() => {
    const url = buildRedirectUrl()
    if (url) {
      setRedirecting(true)
      window.location.href = url
    }
  }, [buildRedirectUrl])

  useEffect(() => {
    if (!redirectUrl || isSub) return
    if (countdown <= 0) {
      handleRedirect()
      return
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, redirectUrl, isSub, handleRedirect])

  // Extract merchant hostname for display
  let merchantHost = ''
  try {
    merchantHost = new URL(redirectUrl).hostname
  } catch {}

  return (
    <div className="pay2-bg">
      <div className="pay2-shell">
        <Logo />
        <div className="pay2-state-screen success">
          <div className="pay2-success-ring">
            <div className="pay2-state-icon success">✓</div>
          </div>
          <div className="pay2-state-title success">Pembayaran Berhasil!</div>
          <div className="pay2-state-desc">
            {isSub ? 'Langganan Anda kini aktif.' : 'Terima kasih telah melakukan pembayaran.'}
          </div>
          <div className="pay2-receipt">
            <InfoRow label="Invoice" value={invoice.invoice_number} mono />
            <InfoRow label="Jumlah" value={`Rp ${fmt(invoice.amount)}`} highlight />
          </div>

          {/* Subscription → billing page */}
          {isSub && (
            <button className="pay2-cta" onClick={() => window.location.href = '/dashboard/billing'}>
              ← Ke Halaman Billing
            </button>
          )}

          {/* Redirect countdown — only when redirect_url is set and not subscription */}
          {redirectUrl && !isSub && (
            <div className="pay2-redirect-section">
              <div className="pay2-redirect-info">
                <span className="pay2-redirect-icon">🔄</span>
                <span>
                  {redirecting
                    ? 'Mengalihkan...'
                    : <>Anda akan dialihkan ke <strong>{invoice.merchant_name || merchantHost}</strong> dalam <strong>{countdown}</strong> detik</>
                  }
                </span>
              </div>
              <div className="pay2-redirect-bar">
                <div
                  className="pay2-redirect-progress"
                  style={{ width: `${((REDIRECT_SECONDS - countdown) / REDIRECT_SECONDS) * 100}%` }}
                />
              </div>
              <button className="pay2-cta" onClick={handleRedirect} disabled={redirecting}>
                {redirecting
                  ? <><div className="pay2-mini-spin white" />Mengalihkan…</>
                  : `← Kembali ke ${invoice.merchant_name || 'Merchant'}`
                }
              </button>
            </div>
          )}
        </div>
        <div className="pay2-powered">Powered by SayaBayar</div>
      </div>
    </div>
  )
}

export default function PayPage() {
  const params = useParams()
  const [invoice, setInvoice] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(null)
  const [selectError, setSelectError] = useState(null) // inline error for channel selection
  const [copied, setCopied] = useState(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const eventSourceRef = useRef(null)

  const fetchInvoice = () =>
    fetch(`${API_URL}/v1/pay/${params.token}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) throw new Error(data.error?.message || 'Invoice tidak ditemukan')
        setInvoice(data.data)
        setStatus(data.data.status)
        return data.data
      })

  useEffect(() => {
    fetchInvoice()
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [params.token])

  // SSE realtime — hanya depends pada invoiceId agar tidak reconnect setiap status berubah.
  // onerror TIDAK close — biarkan browser auto-reconnect (EventSource spec).
  // Hanya close saat unmount atau status sudah final (paid/expired/cancelled).
  const invoiceId = invoice?.id
  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    if (!invoiceId) return
    // Jika status sudah final saat mount, skip SSE
    if (['paid', 'expired', 'cancelled'].includes(statusRef.current)) return

    const es = new EventSource(`${API_URL}/v1/pay/${params.token}/status`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.event === 'invoice.paid') {
          setStatus('paid')
          es.close()  // status final → stop SSE
        } else if (d.event === 'invoice.expired') {
          setStatus('expired')
          es.close()
        } else if (d.event === 'invoice.cancelled') {
          setStatus('cancelled')
          es.close()
        }
      } catch { }
    }

    // Jangan close saat onerror! Browser akan auto-reconnect (sesuai EventSource spec).
    // Hanya log untuk debugging.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        // SSE benar-benar ditutup server (bukan sementara) — tidak perlu reconnect manual
      }
    }

    return () => es.close()
  }, [invoiceId])  // intentionally exclude status — SSE tidak perlu reconnect saat status berubah

  const selectingRef = useRef(false)
  const handleSelectChannel = async (channel) => {
    // Guard double-submit at ref level (state may lag one render)
    if (selectingRef.current) return
    selectingRef.current = true

    const selectId = channel.channel_type === 'qris' ? '__qris__' : channel.id
    setSelecting(selectId)
    setSelectError(null)

    const controller = new AbortController()
    try {
      const body = channel.channel_type === 'qris'
        ? { channel_type: 'qris' }
        : { channel_id: channel.id }

      const res = await fetch(`${API_URL}/v1/pay/${params.token}/select-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const data = await res.json()
      if (!data.success) {
        const code = data.error?.code
        const msg = code === 'RATE_LIMIT_EXCEEDED'
          ? 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.'
          : (data.error?.message || 'Gagal memilih metode pembayaran')
        throw Object.assign(new Error(msg), { code })
      }

      // Update invoice state directly — eliminates a second fetchInvoice() round-trip
      const d = data.data
      setInvoice(prev => ({
        ...prev,
        amount_to_pay: d.amount_to_pay,
        unique_code: d.unique_code,
        expired_at: d.expired_at,
        payment_channel: {
          channel_type: d.channel_type,
          channel_owner: d.channel_owner,
          account_name: d.account_name,
          account_number: d.account_number,
          qris_data: d.qris_data
        }
      }))
    } catch (err) {
      if (err.name !== 'AbortError') setSelectError(err.message)
    } finally {
      selectingRef.current = false
      setSelecting(null)
    }
  }

  const [confirmError, setConfirmError] = useState(null)

  const handleConfirm = async () => {
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch(`${API_URL}/v1/pay/${params.token}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
      const d = await res.json()
      if (d.success) {
        setStatus('user_confirmed')
        setShowConfirmModal(false)
      } else {
        setConfirmError(d.error?.message || 'Gagal mengirim konfirmasi')
      }
    } catch {
      setConfirmError('Koneksi gagal. Coba lagi.')
    } finally {
      setConfirming(false)
    }
  }

  const copy = (text, key) => {
    navigator.clipboard.writeText(String(text))
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="pay2-bg">
      <div className="pay2-shell skeleton-shell">
        <Logo />
        <div className="pay2-pulse-wrap">
          <div className="pay2-pulse" />
          <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>Memuat tagihan…</div>
        </div>
      </div>
    </div>
  )

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) return (
    <div className="pay2-bg">
      <div className="pay2-shell">
        <Logo />
        <div className="pay2-state-screen">
          <div className="pay2-state-icon error">🔍</div>
          <div className="pay2-state-title">Invoice Tidak Ditemukan</div>
          <div className="pay2-state-desc">{error}</div>
        </div>
        <div className="pay2-powered">Powered by SayaBayar</div>
      </div>
    </div>
  )

  // ── PAID ───────────────────────────────────────────────────────────────
  if (status === 'paid') {
    return <PaidScreen invoice={invoice} />
  }

  // ── EXPIRED / CANCELLED ────────────────────────────────────────────────
  if (status === 'expired' || status === 'cancelled') {
    const isExp = status === 'expired'
    return (
      <div className="pay2-bg">
        <div className="pay2-shell">
          <Logo />
          <div className="pay2-state-screen">
            <div className="pay2-state-icon neutral">{isExp ? '⏰' : '✕'}</div>
            <div className="pay2-state-title">Invoice {isExp ? 'Kedaluwarsa' : 'Dibatalkan'}</div>
            <div className="pay2-state-desc">
              {isExp
                ? 'Batas waktu pembayaran telah berakhir. Hubungi penjual untuk tagihan baru.'
                : 'Invoice ini telah dibatalkan oleh penjual. Hubungi penjual untuk informasi lebih lanjut.'}
            </div>
            <div className="pay2-invoice-tag">{invoice.invoice_number}</div>
          </div>
          <div className="pay2-powered">Powered by SayaBayar</div>
        </div>
      </div>
    )
  }

  // ── NO CHANNEL AVAILABLE ───────────────────────────────────────────────
  if (!invoice.payment_channel && !invoice.available_channels?.length) {
    return (
      <div className="pay2-bg">
        <div className="pay2-shell">
          <Logo />
          <div className="pay2-state-screen">
            <div className="pay2-state-icon neutral">🚧</div>
            <div className="pay2-state-title">Metode Pembayaran Belum Tersedia</div>
            <div className="pay2-state-desc">
              Penjual belum mengatur metode pembayaran untuk tagihan ini. Hubungi penjual untuk informasi lebih lanjut.
            </div>
            <div className="pay2-invoice-tag">{invoice.invoice_number}</div>
          </div>
          <div className="pay2-powered">Powered by SayaBayar</div>
        </div>
      </div>
    )
  }

  // ── STEP 1: Pilih Metode ───────────────────────────────────────────────
  if (!invoice.payment_channel && invoice.available_channels?.length > 0) {
    return (
      <div className="pay2-bg">
        <div className="pay2-shell">
          <Logo />
          <StepBar step={1} />

          <MerchantInfo invoice={invoice} />

          <CustomerCard invoice={invoice} />

          <div className="pay2-divider" />


          <div className="pay2-desc">
            <div className="pay2-desc-icon">📋</div>
            <div>
              <div className="pay2-desc-label">Keterangan</div>
              <div className="pay2-desc-text">{invoice.description || 'Pembayaran Tagihan'}</div>
            </div>
          </div>


          {/* Total */}
          <div className="pay2-total-box">
            <span className="pay2-total-label">Total Tagihan</span>
            <span className="pay2-total-amount">Rp {fmt(invoice.amount)}</span>
          </div>

          <div className="pay2-section-label">🏦 Pilih Metode Pembayaran</div>

          <div className="pay2-channels">
            {invoice.available_channels.map(ch => {
              const meta = getMeta(ch.channel_type)
              const isQris = ch.channel_type === 'qris'
              const selectKey = isQris ? '__qris__' : ch.id
              const isLoading = selecting === selectKey
              return (
                <button
                  key={selectKey}
                  className="pay2-channel-item"
                  onClick={() => handleSelectChannel(ch)}
                  disabled={!!selecting}
                  style={{ '--ch-color': meta.color, '--ch-bg': meta.bg }}
                >
                  <div className="pay2-channel-logo" style={{ background: meta.bg, color: meta.color }}>
                    {meta.emoji}
                  </div>
                  <div className="pay2-channel-info">
                    <div className="pay2-channel-name">{meta.name}</div>
                    <div className="pay2-channel-sub">
                      {isQris
                        ? 'Scan QR Code untuk membayar'
                        : `${ch.account_name} • ••• ${String(ch.account_number).slice(-4)}`
                      }
                    </div>
                  </div>
                  <div className="pay2-channel-arrow">
                    {isLoading
                      ? <div className="pay2-mini-spin" />
                      : <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
                    }
                  </div>
                </button>
              )
            })}
          </div>

          {/* Inline error — shown when channel selection fails */}
          {selectError && (
            <div style={{
              margin: '12px 0 0',
              padding: '12px 16px',
              borderRadius: 12,
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}>
              <span style={{ fontSize: '1rem', lineHeight: 1.2 }}>⚠️</span>
              <span>{selectError}</span>
            </div>
          )}

          <OwnerDisclaimer channelOwner={invoice.available_channels?.[0]?.channel_owner} />

          <div className="pay2-powered">🔒 Pembayaran aman &amp; terverifikasi oleh SayaBayar</div>
        </div>
      </div>
    )
  }

  // ── STEP 2: Detail Pembayaran ──────────────────────────────────────────
  const ch = invoice.payment_channel
  const meta = getMeta(ch?.channel_type)
  const isQRIS = ch?.channel_type?.startsWith('qris')
  const total = invoice.amount_to_pay

  return (
    <div className="pay2-bg">
      {/* Confirm Modal */}
      {showConfirmModal && (
        <div className="pay2-modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="pay2-modal" onClick={e => e.stopPropagation()}>
            <div className="pay2-modal-icon">💸</div>
            <div className="pay2-modal-title">Konfirmasi Pembayaran</div>
            <div className="pay2-modal-desc">
              Pastikan Anda sudah mentransfer tepat <strong>Rp {fmt(total)}</strong> ke rekening {meta.name}.
            </div>
            <button className="pay2-cta" onClick={handleConfirm} disabled={confirming}>
              {confirming ? <><div className="pay2-mini-spin white" />Memproses…</> : '✅ Ya, Sudah Saya Bayar'}
            </button>
            {confirmError && (
              <div style={{
                margin: '8px 0',
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#fca5a5',
                fontSize: '0.8rem',
                textAlign: 'center'
              }}>
                ⚠️ {confirmError}
              </div>
            )}
            <button className="pay2-cta-ghost" onClick={() => { setShowConfirmModal(false); setConfirmError(null) }}>
              Belum, kembali
            </button>
          </div>
        </div>
      )}

      <div className="pay2-shell">
        <Logo />
        <StepBar step={2} />

        {/* Channel badge */}
        <div className="pay2-channel-badge" style={{ '--ch-color': meta.color, '--ch-bg': meta.bg }}>
          <span>{meta.emoji}</span>
          <span>{meta.name}</span>
        </div>


        <MerchantInfo invoice={invoice} />
        <CustomerCard invoice={invoice} />

        <div className="pay2-divider" />

        {/* Amount */}
        <AmountBadge
          amount={invoice.amount}
          uniqueCode={invoice.unique_code}
          onClick={() => copy(total, 'amount')}
          copied={copied === 'amount'}
        />

        {invoice.unique_code > 0 && (
          <div className="pay2-unique-note">
            Termasuk {invoice.unique_code.toString().length} digit verifikasi agar pembayaran terdeteksi otomatis
          </div>
        )}

        {/* QR Code — only for QRIS */}
        {isQRIS && ch?.qris_data && (
          <QRCodeDisplay
            qrisData={ch.qris_data}
            nominal={total}
            merchantName={invoice.merchant_name}
          />
        )}

        {/* Transfer Detail Card */}
        <div className="pay2-detail-card">
          <div className="pay2-detail-title">{isQRIS ? '📱 Detail QRIS' : '🏦 Detail Transfer'}</div>

          <InfoRow
            label={isQRIS ? 'Merchant QRIS' : 'Transfer ke'}
            value={ch?.account_name}
          />
          {!isQRIS && (
            <InfoRow
              label="Nomor Rekening"
              value={ch?.account_number}
              mono
              copyValue={ch?.account_number}
              onCopy={() => copy(ch?.account_number, 'rekening')}
              copied={copied === 'rekening'}
              highlight
            />
          )}
          <InfoRow
            label="Jumlah Transfer"
            value={`Rp ${fmt(total)}`}
            copyValue={total}
            onCopy={() => copy(total, 'amount')}
            copied={copied === 'amount'}
            highlight
          />
          <InfoRow
            label="No. Invoice"
            value={invoice.invoice_number}
            mono
          />
        </div>

        <OwnerDisclaimer channelOwner={ch?.channel_owner} />

        {/* Status */}
        <div className={`pay2-status-pill ${status === 'user_confirmed' ? 'processing' : 'waiting'}`}>
          {status === 'user_confirmed' ? (
            <><div className="pay2-status-dot processing" /> Sedang diverifikasi sistem…</>
          ) : (
            <><div className="pay2-status-dot waiting" /> Menunggu pembayaran</>
          )}
        </div>

        {/* CTA */}
        {status === 'pending' && (
          <>
            <div className="pay2-cta-hint">
              Sudah selesai bayar? Klik tombol di bawah — sistem <strong>Saya Bayar</strong> akan verifikasi otomatis.
            </div>
            <button className="pay2-cta" onClick={() => setShowConfirmModal(true)}>
              ✅ Sudah Saya Bayar
            </button>
          </>
        )}

        <Countdown invoice={invoice} status={status} onExpired={() => setStatus('expired')} />

        {/* Steps instructions — paling bawah */}
        {!isQRIS && (
          <div className="pay2-steps-card">
            <div className="pay2-steps-title">📋 Cara Transfer</div>
            <ol className="pay2-steps-list">
              <li>Buka aplikasi {meta.name?.split(' ')[0]} / ATM / m-Banking</li>
              <li>Pilih Transfer → {meta.short}</li>
              <li>Masukkan nomor rekening <strong>{ch?.account_number}</strong></li>
              <li>Masukkan nominal tepat <strong>Rp {fmt(total)}</strong></li>
              <li>Konfirmasi &amp; selesaikan transfer</li>
            </ol>
          </div>
        )}
        <div className="pay2-powered">
          🔒 Pastikan transfer tepat Rp {fmt(total)} agar pembayaran terverifikasi otomatis
        </div>
      </div>
    </div>
  )
}
