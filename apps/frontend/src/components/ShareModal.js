'use client'
import { useState } from 'react'
import { X, Copy, Check } from 'lucide-react'

const CHANNELS = [
  {
    name: 'WhatsApp',
    color: '#25D366',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
    url: (text) => `https://wa.me/?text=${encodeURIComponent(text)}`,
  },
  {
    name: 'Telegram',
    color: '#0088cc',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>,
    url: (text, link) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
  },
  {
    name: 'X',
    color: '#000',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
    url: (text, link) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
  },
  {
    name: 'Email',
    color: '#EA4335',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>,
    url: (text, link, email, subject) => `mailto:${email || ''}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text)}`,
  },
]

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

export default function ShareModal({ open, onClose, invoice }) {
  const [copied, setCopied] = useState(false)

  if (!open || !invoice) return null

  const payUrl = invoice.payment_url
  const name = invoice.customer_name || 'Pelanggan'
  const text = `Hai ${name},\n\nSilakan lakukan pembayaran:\nNominal: Rp ${fmt(invoice.amount)}\nLink: ${payUrl}\n\nTerima kasih!`

  const handleCopy = () => {
    navigator.clipboard.writeText(payUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = (channel) => {
    const url = channel.url(text, payUrl, invoice.customer_email, `Invoice ${invoice.invoice_number}`)
    window.open(url, '_blank')
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Bagikan</h3>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Invoice info */}
        <div className="share-invoice-info">
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{invoice.invoice_number}</div>
          <div className="text-sm text-muted">{name} — Rp {fmt(invoice.amount)}</div>
        </div>

        {/* Link + copy */}
        <div className="share-link-box">
          <span className="share-link-url">{payUrl}</span>
          <button className="share-link-copy" onClick={handleCopy}>
            {copied ? <><Check size={14} /> Tersalin!</> : <><Copy size={14} /> Salin</>}
          </button>
        </div>

        {/* Share buttons */}
        <div className="share-channels">
          {CHANNELS.map(ch => (
            <button key={ch.name} className="share-channel-btn" onClick={() => handleShare(ch)}>
              <div className="share-channel-icon" style={{ background: ch.color }}>
                {ch.icon}
              </div>
              <span className="share-channel-name">{ch.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
