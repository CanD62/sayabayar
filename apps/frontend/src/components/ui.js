'use client'
/**
 * Shared UI components — dipakai di api-keys/page.js dan webhooks/page.js
 * Sebelumnya: tiap halaman punya kode identik sendiri-sendiri
 */

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * CopyButton — salin teks ke clipboard, tampilkan feedback "Tersalin"
 * Usage: <CopyButton text={someText} />
 */
export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handle}
      title="Salin"
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: copied ? 'var(--success)' : 'var(--text-muted)',
        padding: '4px', display: 'flex', alignItems: 'center',
        gap: 4, fontSize: '0.75rem'
      }}
    >
      {copied ? <><Check size={13} /> Tersalin</> : <><Copy size={13} /> Salin</>}
    </button>
  )
}

/**
 * StepHeading — numbered step header untuk panduan/dokumentasi
 * Usage: <StepHeading n={1} title="Generate API Key" />
 */
export function StepHeading({ n, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 8px' }}>
      <span style={{
        width: 24, height: 24, borderRadius: '50%',
        background: 'var(--primary)', color: '#fff',
        fontSize: '0.75rem', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0
      }}>{n}</span>
      <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{title}</span>
    </div>
  )
}

/**
 * SecretReveal — tampil secret/key yang hanya boleh dilihat sekali
 * Dengan tombol copy dan tombol tutup
 * Usage: <SecretReveal label="API Key Baru" value={createdKey} icon={<KeyRound />} onClose={() => setCreatedKey(null)} />
 */
export function SecretReveal({ label, value, icon, onClose }) {
  if (!value) return null
  return (
    <div className="card mb-4" style={{ borderColor: 'var(--success)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {icon && <span style={{ color: 'var(--success)' }}>{icon}</span>}
        <h3 style={{ color: 'var(--success)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>{label}</h3>
      </div>
      <p className="text-sm text-muted" style={{ marginBottom: 8 }}>Simpan ini — hanya ditampilkan sekali!</p>
      <div style={{ position: 'relative' }}>
        <code
          className="font-mono"
          style={{ background: 'var(--bg-input)', padding: '10px 14px', paddingRight: 70, borderRadius: 6, display: 'block', wordBreak: 'break-all' }}
        >
          {value}
        </code>
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 8 }}>
          <CopyButton text={value} />
        </div>
      </div>
      <button className="btn btn-ghost btn-sm mt-2" onClick={onClose}>Tutup</button>
    </div>
  )
}

/**
 * Modal — wrapper modal umum yang menangani overlay + stopPropagation
 * Usage:
 *   <Modal open={showModal} onClose={() => setShowModal(false)} title="Judul Modal" maxWidth={480}>
 *     <form>...</form>
 *   </Modal>
 */
export function Modal({ open, onClose, title, children, maxWidth = 520 }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth }} onClick={e => e.stopPropagation()}>
        {title && <h3 className="modal-title">{title}</h3>}
        {children}
      </div>
    </div>
  )
}
