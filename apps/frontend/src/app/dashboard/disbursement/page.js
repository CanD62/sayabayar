'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { getDisbursementFee } from '@/lib/disbursement'
import { useToast } from '@/components/Toast'
import {
  Send, Upload, CreditCard, ArrowUpRight, RefreshCw, Search,
  AlertTriangle, Check, Copy, Loader2, X, Clock, Ban,
  ShieldCheck, Camera, FileText, ChevronDown, ChevronUp, ArrowDown, BookOpen, Code
} from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const BANK_OPTIONS = [
  // Big 5
  { code: 'bca', name: 'BCA' }, { code: 'bri', name: 'BRI' },
  { code: 'mandiri', name: 'Bank Mandiri' }, { code: 'bni', name: 'BNI' },
  { code: 'bsm', name: 'BSI' },
  // Major
  { code: 'cimb', name: 'CIMB Niaga' }, { code: 'permata', name: 'Permata' },
  { code: 'danamon', name: 'Danamon' }, { code: 'btn', name: 'BTN' },
  { code: 'muamalat', name: 'Muamalat' }, { code: 'mega', name: 'Bank Mega' },
  { code: 'panin', name: 'Panin Bank' }, { code: 'ocbc', name: 'OCBC NISP' },
  { code: 'bukopin', name: 'KB Bukopin' }, { code: 'sinarmas', name: 'Sinarmas' },
  { code: 'dki', name: 'Bank DKI' }, { code: 'bjb', name: 'BJB' },
  { code: 'tabungan_pensiunan_nasional', name: 'BTPN' },
  { code: 'kesejahteraan_ekonomi', name: 'SeaBank' },
  // Neobank
  { code: 'artos', name: 'Bank Jago' }, { code: 'royal', name: 'Blu/BCA Digital' },
  { code: 'super_bank', name: 'Superbank' }, { code: 'saqu', name: 'Bank Saqu' },
  { code: 'krom', name: 'Krom Bank' }, { code: 'amar', name: 'Amar Bank' },
  { code: 'harda', name: 'Allo Bank' }, { code: 'nationalnobu', name: 'Nobu Bank' },
]

const STATUS_CONFIG = {
  pending:    { label: 'Menunggu', cls: 'badge-warning', icon: Clock },
  processing: { label: 'Diproses', cls: 'badge-info', icon: Loader2 },
  success:    { label: 'Berhasil', cls: 'badge-success', icon: Check },
  failed:     { label: 'Gagal', cls: 'badge-danger', icon: Ban },
}

// ═══════════════════════════════════════════
// SEARCHABLE BANK SELECT
// ═══════════════════════════════════════════
function BankSelect({ value, onChange, options, id }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.code === value)
  const filtered = options.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) || o.code.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => { setOpen(!open); setSearch('') }} id={id}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, textAlign: 'left', border: `1px solid ${open ? '#6366f1' : 'var(--border)'}`, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.88rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'border-color 0.2s' }}>
        <span>{selected?.name || 'Pilih bank'}</span>
        <ChevronDown size={12} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <input autoFocus type="text" placeholder="Cari bank..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {filtered.length === 0 && <div style={{ padding: '10px 14px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tidak ditemukan</div>}
            {filtered.map(b => (
              <button key={b.code} type="button" onClick={() => { onChange(b.code); setOpen(false) }}
                style={{ width: '100%', padding: '8px 14px', border: 'none', textAlign: 'left', background: b.code === value ? 'rgba(99,102,241,0.12)' : 'transparent', color: b.code === value ? '#818cf8' : 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: b.code === value ? 700 : 400, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={e => { if (b.code !== value) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (b.code !== value) e.currentTarget.style.background = 'transparent' }}>
                <span>{b.name}</span>
                {b.code === value && <Check size={14} style={{ color: '#6366f1' }} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// KYC ONBOARDING FORM
// ═══════════════════════════════════════════
function KycOnboarding({ kycStatus, rejectionReason, onSubmitted }) {
  const toast = useToast()
  const [fullName, setFullName] = useState('')
  const [ktpNumber, setKtpNumber] = useState('')
  const [ktpFile, setKtpFile] = useState(null)
  const [selfieFile, setSelfieFile] = useState(null)
  const [ktpPreview, setKtpPreview] = useState(null)
  const [selfiePreview, setSelfiePreview] = useState(null)
  const [loading, setLoading] = useState(false)

  const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const handleFile = (file, setter, previewSetter) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('File terlalu besar (max 5MB)'); return }
    setter(file)
    const reader = new FileReader()
    reader.onload = (e) => previewSetter(e.target.result)
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!ktpFile || !selfieFile || !fullName || !ktpNumber) {
      toast.error('Semua field wajib diisi'); return
    }
    if (!/^\d{16}$/.test(ktpNumber)) {
      toast.error('Nomor KTP harus 16 digit angka'); return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('ktp_image', ktpFile)
      formData.append('selfie_image', selfieFile)
      formData.append('full_name', fullName)
      formData.append('ktp_number', ktpNumber)

      await api.upload('/v1/kyc/submit', formData)
      toast.success('Dokumen KYC berhasil di-submit! 🎉')
      onSubmitted()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <ShieldCheck size={28} style={{ color: '#6366f1' }} />
        </div>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 8px' }}>Verifikasi Identitas</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
          Untuk menggunakan fitur Disbursement, Anda perlu menyelesaikan verifikasi KYC.
        </p>
      </div>

      {/* Rejection notice */}
      {kycStatus === 'rejected' && rejectionReason && (
        <div style={{ padding: '12px 16px', borderRadius: 12, marginBottom: 20, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.82rem', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>KYC Ditolak</div>
            <div>{rejectionReason}</div>
            <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>Silakan submit ulang dokumen Anda.</div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Selfie instructions */}
        <div style={{ padding: '16px', borderRadius: 12, marginBottom: 20, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#f59e0b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Camera size={14} /> Instruksi Foto Selfie
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Siapkan selembar kertas bertuliskan:<br />
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>1. SAYABAYAR.COM</span><br />
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>2. Tanggal hari ini ({today})</span><br />
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>3. Tanda tangan Anda</span><br />
            Pegang kertas tersebut di samping wajah, lalu ambil foto selfie.
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Nama Lengkap (sesuai KTP)</label>
          <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Masukkan nama lengkap"
            style={inputStyle} required />
        </div>

        {/* KTP number */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Nomor KTP (NIK)</label>
          <input type="text" value={ktpNumber} onChange={e => setKtpNumber(e.target.value.replace(/\D/g, '').slice(0, 16))} placeholder="16 digit NIK"
            style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }} maxLength={16} required />
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>{ktpNumber.length}/16 digit</div>
        </div>

        {/* KTP upload */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Foto KTP</label>
          <div style={uploadBoxStyle}>
            {ktpPreview ? (
              <div style={{ position: 'relative' }}>
                <img src={ktpPreview} alt="KTP" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }} />
                <button type="button" onClick={() => { setKtpFile(null); setKtpPreview(null) }} style={removeImgBtn}><X size={14} /></button>
              </div>
            ) : (
              <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 16px' }}>
                <FileText size={28} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Klik untuk upload foto KTP</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>JPG, PNG, WebP · Max 5MB</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files[0], setKtpFile, setKtpPreview)} />
              </label>
            )}
          </div>
        </div>

        {/* Selfie upload */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Foto Selfie + Kertas</label>
          <div style={uploadBoxStyle}>
            {selfiePreview ? (
              <div style={{ position: 'relative' }}>
                <img src={selfiePreview} alt="Selfie" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }} />
                <button type="button" onClick={() => { setSelfieFile(null); setSelfiePreview(null) }} style={removeImgBtn}><X size={14} /></button>
              </div>
            ) : (
              <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 16px' }}>
                <Camera size={28} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Klik untuk upload foto selfie</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Pastikan kertas & wajah terlihat jelas</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files[0], setSelfieFile, setSelfiePreview)} />
              </label>
            )}
          </div>
        </div>

        <button type="submit" disabled={loading || !ktpFile || !selfieFile || !fullName || ktpNumber.length !== 16}
          className="btn btn-primary" style={{ width: '100%', padding: '14px', fontSize: '0.92rem', fontWeight: 700 }}>
          {loading ? <><Loader2 size={16} className="spin" /> Mengirim...</> : <><Upload size={16} /> Submit Verifikasi KYC</>}
        </button>
      </form>
    </div>
  )
}

// ═══════════════════════════════════════════
// DEPOSIT MODAL
// ═══════════════════════════════════════════
function DepositModal({ open, onClose, onSuccess }) {
  const [step, setStep] = useState('form')
  const [amount, setAmount] = useState(100000)
  const [senderBank, setSenderBank] = useState('bca')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [depositData, setDepositData] = useState(null)
  const [copied, setCopied] = useState('')
  const [pollInterval, setPollInterval] = useState(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  useEffect(() => {
    if (open) { setStep('form'); setAmount(100000); setError(''); setDepositData(null); setCancelLoading(false) }
    return () => { if (pollInterval) clearInterval(pollInterval) }
  }, [open])

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 2000)
  }

  const handleCreate = async () => {
    setLoading(true); setError('')
    try {
      const res = await api.post('/v1/disbursements/deposit', { amount: Math.round(amount), sender_bank: senderBank })
      setDepositData(res.data); setStep('transferring')
      // If resume, update amount display from existing data
      if (res.data?.resumed) {
        setAmount(res.data.amount)
        setSenderBank(res.data.sender_bank || senderBank)
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleConfirm = async () => {
    if (!depositData?.deposit_id) return
    setLoading(true); setError('')
    try {
      await api.post(`/v1/disbursements/deposit/${depositData.deposit_id}/confirm`)
      setStep('polling'); startPolling(depositData.deposit_id)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleCancel = async () => {
    if (!depositData?.deposit_id) return
    setCancelLoading(true); setError('')
    try {
      await api.post(`/v1/disbursements/deposit/${depositData.deposit_id}/cancel`)
      setDepositData(null); setStep('form'); setError('')
    } catch (e) { setError(e.message) }
    finally { setCancelLoading(false) }
  }

  const startPolling = (id) => {
    let count = 0
    const iv = setInterval(async () => {
      count++
      try {
        const res = await api.get(`/v1/disbursements/deposit/${id}/status`)
        setDepositData(prev => ({ ...prev, ...res.data }))
        if (res.data?.status === 'done') {
          clearInterval(iv); setPollInterval(null); setStep('done'); onSuccess?.()
        }
      } catch {}
      if (count > 60) { clearInterval(iv); setPollInterval(null) }
    }, 5000)
    setPollInterval(iv)
  }

  if (!open) return null
  const totalTransfer = depositData ? (Number(depositData.amount) + (depositData.unique_code || 0)) : 0
  const rb = depositData?.receiver_bank

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ArrowDown size={16} /></div>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Deposit Saldo</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        {error && <div style={{ margin: '0 20px', padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {error}</div>}

        {step === 'form' && (
          <div style={{ padding: '16px 20px 20px' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Nominal Deposit</label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-input)' }}>
                <span style={{ padding: '10px 12px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRight: '1px solid var(--border)' }}>Rp</span>
                <input type="number" min="10000" step="1000" value={amount} onChange={e => setAmount(Number(e.target.value))}
                  style={{ flex: 1, padding: '10px 12px', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace' }} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[50000, 100000, 200000, 500000, 1000000].map(v => (
                  <button key={v} type="button" onClick={() => setAmount(v)}
                    style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${amount === v ? '#6366f1' : 'var(--border)'}`, background: amount === v ? 'rgba(99,102,241,0.15)' : 'transparent', color: amount === v ? '#6366f1' : 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                    {fmt(v)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Bank Pengirim</label>
              <BankSelect value={senderBank} onChange={setSenderBank} options={BANK_OPTIONS} id="deposit-bank" />
            </div>
            <button onClick={handleCreate} disabled={loading || amount < 10000}
              className="btn btn-primary" style={{ width: '100%', padding: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {loading ? <><Loader2 size={14} className="spin" /> Memproses...</> : 'Buat Deposit'}
            </button>
          </div>
        )}

        {step === 'transferring' && depositData && (
          <div style={{ padding: '16px 20px 20px' }}>
            {depositData.resumed ? (
              <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '0.78rem', fontWeight: 600 }}>
                ⏳ Melanjutkan deposit sebelumnya. Transfer sesuai detail berikut:
              </div>
            ) : (
              <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', fontSize: '0.78rem', fontWeight: 600 }}>
                ✅ Deposit berhasil dibuat! Transfer sesuai detail berikut:
              </div>
            )}
            <div style={{ padding: '12px 16px', borderRadius: 12, marginBottom: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <DetailRow label="Bank Tujuan" value={rb?.bank?.toUpperCase() || '-'} />
              <DetailRow label="No. Rekening" value={rb?.account_number || '-'} copiable onCopy={() => copyText(rb?.account_number, 'rek')} isCopied={copied === 'rek'} />
              <DetailRow label="Atas Nama" value={rb?.name || '-'} />
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <DetailRow label="Nominal" value={`Rp ${fmt(depositData.amount)}`} />
              <DetailRow label="Kode Unik" value={`+${depositData.unique_code || 0}`} accent />
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <DetailRow label="Total Transfer" value={`Rp ${fmt(totalTransfer)}`} bold copiable onCopy={() => copyText(String(totalTransfer), 'total')} isCopied={copied === 'total'} />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              ⚠️ Pastikan transfer <strong>tepat Rp {fmt(totalTransfer)}</strong> (termasuk kode unik).
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCancel} disabled={cancelLoading}
                className="btn btn-ghost" style={{ flex: '0 0 auto', padding: '12px 16px', fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {cancelLoading ? <Loader2 size={14} className="spin" /> : <X size={14} />} Batalkan
              </button>
              <button onClick={handleConfirm} disabled={loading} className="btn btn-primary" style={{ flex: 1, padding: '12px', fontWeight: 700 }}>
                {loading ? <><Loader2 size={14} className="spin" /> Mengonfirmasi...</> : '✓ Sudah Transfer — Konfirmasi'}
              </button>
            </div>
          </div>
        )}

        {step === 'polling' && (
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <Loader2 size={32} className="spin" style={{ color: '#6366f1', marginBottom: 12 }} />
            <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>Menunggu Konfirmasi...</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Status: <span style={{ color: '#f59e0b', fontWeight: 700 }}>{depositData?.status || 'PENDING'}</span></div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8 }}>Polling otomatis setiap 5 detik...</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#10b981', marginBottom: 4 }}>Deposit Berhasil!</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Saldo bertambah Rp {fmt(depositData?.amount || 0)}
            </div>
            <button onClick={onClose} className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>Tutup</button>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, bold, accent, copiable, onCopy, isCopied }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: bold ? 800 : accent ? 700 : 600, fontSize: bold ? '1.05rem' : '0.85rem', color: accent ? '#f59e0b' : bold ? '#10b981' : 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</span>
        {copiable && (
          <button onClick={onCopy} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }} title="Salin">
            {isCopied ? <Check size={12} style={{ color: '#10b981' }} /> : <Copy size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════
export default function DisbursementPage() {
  const { user } = useAuth()
  const router = useRouter()
  const toast = useToast()

  const [kycData, setKycData] = useState(null)
  const [kycLoading, setKycLoading] = useState(true)
  const [balance, setBalance] = useState(null)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [showDeposit, setShowDeposit] = useState(false)

  // Transfer form
  const [destBank, setDestBank] = useState('')
  const [destAccount, setDestAccount] = useState('')
  const [destName, setDestName] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [inquiryLoading, setInquiryLoading] = useState(false)
  const [inquiryResult, setInquiryResult] = useState(null)
  const [transferLoading, setTransferLoading] = useState(false)

  // History
  const [disbursements, setDisbursements] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)

  // Bank list from API
  const [bankList, setBankList] = useState(null)

  // ── Redirect if not disbursement_user ─────
  useEffect(() => {
    if (user && user.role !== 'disbursement_user') {
      router.push('/dashboard')
    }
  }, [user, router])

  // ── Load KYC status ───────────────────────
  const loadKyc = useCallback(async () => {
    setKycLoading(true)
    try {
      const res = await api.get('/v1/kyc/status')
      setKycData(res.data)
    } catch { }
    finally { setKycLoading(false) }
  }, [])

  // ── Load balance ──────────────────────────
  const loadBalance = useCallback(async () => {
    setBalanceLoading(true)
    try {
      const res = await api.get('/v1/disbursements/balance')
      setBalance(res.data)
    } catch { }
    finally { setBalanceLoading(false) }
  }, [])

  // ── Load history ──────────────────────────
  const loadHistory = useCallback(async (p = 1) => {
    setHistoryLoading(true)
    try {
      const res = await api.get(`/v1/disbursements?page=${p}&per_page=10`)
      setDisbursements(res.data)
      setHistoryTotal(res.pagination?.total || 0)
    } catch { }
    finally { setHistoryLoading(false) }
  }, [])

  useEffect(() => { loadKyc() }, [])
  useEffect(() => {
    if (kycData?.kyc_status === 'approved') {
      loadBalance()
      loadHistory()
      // Load bank list
      api.get('/v1/disbursements/banks').then(r => setBankList(r.data)).catch(() => {})
    }
  }, [kycData?.kyc_status])

  // ── Inquiry ───────────────────────────────
  const handleInquiry = async () => {
    if (!destBank || !destAccount) return
    setInquiryLoading(true); setInquiryResult(null)
    try {
      const res = await api.post('/v1/disbursements/inquiry', { bank: destBank, account_number: destAccount })
      setInquiryResult(res.data)
      const name = res.data?.account_name || res.data?.account_holder || res.data?.name
      if (name) setDestName(name)
    } catch (e) {
      toast.error(e.message)
    }
    finally { setInquiryLoading(false) }
  }

  // ── Transfer ──────────────────────────────
  const handleTransfer = async () => {
    const amount = Number(transferAmount)
    if (amount < 10000) { toast.error('Minimal transfer Rp 10.000'); return }
    if (!destBank || !destAccount || !destName) { toast.error('Lengkapi data rekening tujuan'); return }

    setTransferLoading(true)
    try {
      const res = await api.post('/v1/disbursements/transfer', {
        amount,
        destination_bank: destBank,
        destination_account: destAccount,
        destination_name: destName,
        note: transferNote || undefined,
      })
      toast.success(`Transfer Rp ${fmt(amount)} berhasil dibuat! 🚀`)
      // Reset form
      setDestBank(''); setDestAccount(''); setDestName(''); setTransferAmount(''); setTransferNote(''); setInquiryResult(null)
      loadBalance()
      loadHistory()
    } catch (e) {
      toast.error(e.message)
    }
    finally { setTransferLoading(false) }
  }

  if (kycLoading) {
    return <div className="loading"><div className="spinner" /></div>
  }

  // ── KYC Gate ─────────────────────────────
  if (kycData?.kyc_status !== 'approved') {
    // Pending state
    if (kycData?.kyc_status === 'pending') {
      return (
        <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Clock size={28} style={{ color: '#f59e0b' }} />
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 8px' }}>Menunggu Verifikasi</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 16 }}>
            Dokumen KYC Anda sedang dalam proses review oleh tim kami.<br />
            Estimasi: 1x24 jam kerja.
          </p>
          <div style={{ padding: '12px 20px', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#f59e0b', fontWeight: 600 }}>
            <Loader2 size={14} className="spin" /> Menunggu review admin...
          </div>
        </div>
      )
    }

    // Not submitted or rejected
    return (
      <>
        <div className="page-header">
          <div>
            <h1 className="page-title">Disbursement</h1>
            <p className="page-subtitle">Verifikasi identitas untuk mulai transfer</p>
          </div>
        </div>
        <KycOnboarding kycStatus={kycData?.kyc_status} rejectionReason={kycData?.rejection_reason} onSubmitted={loadKyc} />
      </>
    )
  }

  // ── Main Dashboard ───────────────────────
  const transferAmt = Number(transferAmount) || 0
  const fee = getDisbursementFee(transferAmt)
  const totalDeducted = transferAmt + fee

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Disbursement</h1>
          <p className="page-subtitle">Transfer dana ke rekening tujuan</p>
        </div>
      </div>

      {/* Balance Card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(99,102,241,0.05))' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Saldo Disbursement</div>
          {balanceLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.82rem' }}><Loader2 size={12} className="spin" /> Memuat...</div>
          ) : (
            <div style={{ fontWeight: 800, fontSize: '1.5rem', color: '#10b981', fontFamily: 'monospace' }}>Rp {fmt(balance?.balance || 0)}</div>
          )}
          <button onClick={() => setShowDeposit(true)} className="btn btn-sm" style={{ marginTop: 12, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', fontWeight: 700 }}>
            <ArrowDown size={13} /> Deposit
          </button>
        </div>

        {balance && (
          <>
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Total Deposited</div>
              <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#6366f1', fontFamily: 'monospace' }}>Rp {fmt(balance.total_deposited)}</div>
            </div>
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Total Disbursed</div>
              <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#f59e0b', fontFamily: 'monospace' }}>Rp {fmt(balance.total_disbursed)}</div>
            </div>
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Total Biaya</div>
              <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#ef4444', fontFamily: 'monospace' }}>Rp {fmt(balance.total_fees)}</div>
            </div>
          </>
        )}
      </div>

      {/* Transfer Form */}
      <div className="card" style={{ padding: '24px', marginBottom: 24 }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Send size={18} style={{ color: '#6366f1' }} /> Transfer Baru
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {/* Left column */}
          <div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Bank Tujuan</label>
              <BankSelect value={destBank} onChange={(v) => { setDestBank(v); setInquiryResult(null); setDestName('') }} options={bankList || BANK_OPTIONS} id="transfer-bank" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Nomor Rekening</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" value={destAccount} onChange={e => { setDestAccount(e.target.value.replace(/\D/g, '')); setInquiryResult(null); setDestName('') }}
                  placeholder="Masukkan nomor rekening" style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
                <button type="button" onClick={handleInquiry} disabled={inquiryLoading || !destBank || !destAccount}
                  className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', whiteSpace: 'nowrap' }}>
                  {inquiryLoading ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Cek
                </button>
              </div>
              {inquiryResult && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)', fontSize: '0.82rem', color: '#10b981', fontWeight: 600 }}>
                  ✓ {inquiryResult.account_name || inquiryResult.account_holder || inquiryResult.name || destName}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Nominal Transfer</label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-input)' }}>
                <span style={{ padding: '10px 12px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-muted)', borderRight: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>Rp</span>
                <input type="number" min="10000" value={transferAmount} onChange={e => setTransferAmount(e.target.value)}
                  placeholder="Min. 10.000" style={{ flex: 1, padding: '10px 12px', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 700, fontFamily: 'monospace' }} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Catatan (opsional)</label>
              <input type="text" value={transferNote} onChange={e => setTransferNote(e.target.value)} placeholder="e.g. Pembayaran gaji"
                style={inputStyle} maxLength={255} />
            </div>

            {/* Summary */}
            {transferAmt >= 10000 && (
              <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>Nominal</span><span style={{ fontFamily: 'monospace' }}>Rp {fmt(transferAmt)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>Biaya</span><span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>Rp {fmt(fee)}</span>
                </div>
                <div style={{ height: 1, background: 'rgba(99,102,241,0.15)', margin: '6px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', fontWeight: 800 }}>
                  <span>Total Potong</span><span style={{ fontFamily: 'monospace', color: '#ef4444' }}>Rp {fmt(totalDeducted)}</span>
                </div>
              </div>
            )}

            <button onClick={handleTransfer} disabled={transferLoading || transferAmt < 10000 || !destBank || !destAccount || !destName}
              className="btn btn-primary" style={{ width: '100%', padding: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {transferLoading ? <><Loader2 size={14} className="spin" /> Mengirim...</> : <><Send size={14} /> Kirim Transfer</>}
            </button>
          </div>
        </div>
      </div>

      {/* Transfer History */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={18} style={{ color: '#6366f1' }} /> Riwayat Transfer
          </h3>
          <button onClick={() => loadHistory(historyPage)} className="btn btn-sm btn-ghost"><RefreshCw size={12} /></button>
        </div>

        {historyLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
        ) : disbursements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Belum ada riwayat transfer
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {disbursements.map(d => {
              const sc = STATUS_CONFIG[d.status] || {}
              const Icon = sc.icon || Clock
              return (
                <div key={d.id} style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{d.destination_bank} — {d.destination_account}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.destination_name} {d.note ? `· ${d.note}` : ''}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{new Date(d.created_at).toLocaleString('id-ID')}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', fontFamily: 'monospace' }}>Rp {fmt(d.amount)}</div>
                    <span className={`badge ${sc.cls}`} style={{ marginTop: 4 }}><Icon size={10} /> {sc.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {Math.ceil(historyTotal / 10) > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button disabled={historyPage <= 1} onClick={() => { setHistoryPage(p => p - 1); loadHistory(historyPage - 1) }} className="btn btn-sm btn-ghost">← Prev</button>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 0' }}>{historyPage} / {Math.ceil(historyTotal / 10)}</span>
            <button disabled={historyPage >= Math.ceil(historyTotal / 10)} onClick={() => { setHistoryPage(p => p + 1); loadHistory(historyPage + 1) }} className="btn btn-sm btn-ghost">Next →</button>
          </div>
        )}
      </div>

      {/* API Documentation */}
      <DisbursementApiDocs />

      {/* Deposit Modal */}
      <DepositModal open={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={() => { loadBalance(); loadHistory() }} />
    </>
  )
}

// ═══════════════════════════════════════════
// RESPONSE EXAMPLES
// ═══════════════════════════════════════════
const RESPONSE_DATA = {
  'GET /balance': `{
  "success": true,
  "data": {
    "balance": 500000,
    "total_deposited": 1000000,
    "total_disbursed": 475000,
    "total_fees": 25000
  }
}`,
  'GET /banks': `{
  "success": true,
  "data": [
    { "code": "bca", "name": "BCA", "popular": true, "isEwallet": false },
    { "code": "bri", "name": "BRI", "popular": true, "isEwallet": false },
    { "code": "mandiri", "name": "Bank Mandiri", "popular": true, "isEwallet": false },
    { "code": "bni", "name": "BNI", "popular": true, "isEwallet": false },
    { "code": "artos", "name": "Bank Jago", "popular": false, "isEwallet": false },
    ...
  ]
}`,
  'POST /inquiry': `{
  "success": true,
  "data": {
    "account_name": "Puput Candra Saputra",
    "account_number": "591201015454531",
    "bank": "bri"
  }
}`,
  'POST /transfer': `{
  "success": true,
  "data": {
    "id": "dda3c09a-bfbd-4ea8-a96c-890022b6b67d",
    "amount": 50000,
    "fee": 2500,
    "total_deducted": 52500,
    "destination_bank": "BRI",
    "destination_account": "591201015454531",
    "destination_name": "Puput Candra",
    "status": "pending",
    "note": "Pembayaran gaji",
    "created_at": "2026-04-16T00:00:00.000+07:00"
  }
}`,
  'GET /:id': `{
  "success": true,
  "data": {
    "id": "dda3c09a-bfbd-4ea8-a96c-890022b6b67d",
    "amount": 50000,
    "fee": 2500,
    "total_deducted": 52500,
    "destination_bank": "BRI",
    "destination_account": "591201015454531",
    "destination_name": "Puput Candra",
    "status": "success",
    "failure_reason": null,
    "note": "Pembayaran gaji",
    "source": "api",
    "created_at": "2026-04-16T00:00:00.000+07:00",
    "processed_at": "2026-04-16T00:00:05.000+07:00"
  }
}`,
  'GET / (list)': `{
  "success": true,
  "data": [
    {
      "id": "dda3c09a-...",
      "amount": 50000,
      "fee": 2500,
      "total_deducted": 52500,
      "destination_bank": "BRI",
      "destination_account": "591201015454531",
      "destination_name": "Puput Candra",
      "status": "success",
      "source": "api",
      "created_at": "2026-04-16T00:00:00.000+07:00"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 42,
    "total_pages": 3
  }
}`,
  'Error': `{
  "success": false,
  "error": {
    "code": "DISBURSEMENT_INSUFFICIENT_BALANCE",
    "message": "Saldo tidak cukup. Diperlukan Rp 52.500 ..."
  }
}`,
}

function ResponseTabs() {
  const [active, setActive] = useState('POST /transfer')
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Contoh Response</div>
      <div style={{ display: 'flex', gap: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', flexWrap: 'wrap' }}>
        {Object.keys(RESPONSE_DATA).map(key => (
          <button key={key} onClick={() => setActive(key)}
            style={{
              padding: '4px 10px', borderRadius: '6px 6px 0 0', fontSize: '0.68rem', border: 'none', cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              fontWeight: active === key ? 700 : 400,
              background: active === key ? 'var(--bg-input)' : 'transparent',
              color: active === key
                ? (key === 'Error' ? '#f87171' : '#10b981')
                : 'var(--text-muted)',
              borderBottom: active === key
                ? `2px solid ${key === 'Error' ? '#f87171' : '#10b981'}`
                : '2px solid transparent',
            }}>{key}</button>
        ))}
      </div>
      <pre style={{
        background: active === 'Error'
          ? 'color-mix(in srgb, #f87171 5%, var(--bg-input))'
          : 'color-mix(in srgb, #10b981 5%, var(--bg-input))',
        padding: '14px', fontSize: '0.72rem', margin: 0, lineHeight: 1.6, borderRadius: '0 8px 8px 8px', overflowX: 'auto', maxHeight: 350,
      }}>{RESPONSE_DATA[active]}</pre>
    </div>
  )
}

// ═══════════════════════════════════════════
// API DOCUMENTATION (only visible on this role-gated page)
// ═══════════════════════════════════════════
function DisbursementApiDocs() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('curl')
  const [copied, setCopied] = useState(false)

  const copyCode = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const endpoints = [
    { method: 'GET',  path: '/v1/disbursements/balance', desc: 'Cek saldo disbursement' },
    { method: 'GET',  path: '/v1/disbursements/banks',   desc: 'List bank yang didukung' },
    { method: 'POST', path: '/v1/disbursements/inquiry',  desc: 'Cek nama pemilik rekening' },
    { method: 'POST', path: '/v1/disbursements/transfer', desc: 'Kirim transfer — fee Rp 2.500 (<250k) atau Rp 3.000 (≥250k)' },
    { method: 'GET',  path: '/v1/disbursements/:id',      desc: 'Detail & status transfer' },
    { method: 'GET',  path: '/v1/disbursements',          desc: 'Riwayat transfer (pagination)' },
  ]

  const curlCode = `API_KEY="sk_live_xxxx..."
BASE="https://api.sayabayar.com/v1"

# ── Cek saldo disbursement
curl "$BASE/disbursements/balance" \\
  -H "X-API-Key: $API_KEY"

# ── Cek rekening (inquiry)
curl -X POST "$BASE/disbursements/inquiry" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -d '{"bank": "bri", "account_number": "591201015454531"}'

# ── Kirim transfer
curl -X POST "$BASE/disbursements/transfer" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -d '{
    "amount": 50000,
    "destination_bank": "bri",
    "destination_account": "591201015454531",
    "destination_name": "Puput Candra",
    "note": "Pembayaran gaji"
  }'

# ── Cek status transfer
curl "$BASE/disbursements/{id}" \\
  -H "X-API-Key: $API_KEY"

# ── Riwayat transfer
curl "$BASE/disbursements?page=1&per_page=10" \\
  -H "X-API-Key: $API_KEY"`

  const nodeCode = `const API_KEY = 'sk_live_xxxx...'
const BASE    = 'https://api.sayabayar.com/v1'
const headers = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY }

// ── Cek saldo
const bal = await fetch(\`\${BASE}/disbursements/balance\`, { headers })
const { data: balance } = await bal.json()
console.log('Saldo:', balance.balance)

// ── Inquiry rekening
const inq = await fetch(\`\${BASE}/disbursements/inquiry\`, {
  method: 'POST', headers,
  body: JSON.stringify({ bank: 'bri', account_number: '591201015454531' })
})
const { data: account } = await inq.json()
console.log('Nama:', account.account_name) // "Puput Candra Saputra"

// ── Transfer (min Rp 10.000, fee Rp 2.500 otomatis)
const tf = await fetch(\`\${BASE}/disbursements/transfer\`, {
  method: 'POST', headers,
  body: JSON.stringify({
    amount: 50000,
    destination_bank: 'bri',
    destination_account: '591201015454531',
    destination_name: 'Puput Candra',
    note: 'Pembayaran gaji'
  })
})
const { data: transfer } = await tf.json()
console.log('Transfer ID:', transfer.id, 'Status:', transfer.status)

// ── Cek status transfer
const detail = await fetch(\`\${BASE}/disbursements/\${transfer.id}\`, { headers })
const { data: trx } = await detail.json()
console.log('Status:', trx.status) // pending → processing → success`

  const phpCode = `<?php
$api_key = 'sk_live_xxxx...';
$base    = 'https://api.sayabayar.com/v1';

function disbursementApi(string $url, string $api_key, array $opts = []): array {
    $ch = curl_init($url);
    $headers = ["Content-Type: application/json", "X-API-Key: $api_key"];
    curl_setopt_array($ch, $opts + [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);
    return json_decode($raw, true) ?: [];
}

// ── Cek saldo
$bal = disbursementApi("$base/disbursements/balance", $api_key);
echo "Saldo: Rp " . number_format($bal['data']['balance']) . "\\n";

// ── Inquiry rekening
$inq = disbursementApi("$base/disbursements/inquiry", $api_key, [
    CURLOPT_POST       => true,
    CURLOPT_POSTFIELDS => json_encode([
        'bank'           => 'bri',
        'account_number' => '591201015454531',
    ])
]);
echo "Nama: " . $inq['data']['account_name'] . "\\n";

// ── Transfer (min Rp 10.000, fee Rp 2.500 otomatis)
$tf = disbursementApi("$base/disbursements/transfer", $api_key, [
    CURLOPT_POST       => true,
    CURLOPT_POSTFIELDS => json_encode([
        'amount'              => 50000,
        'destination_bank'    => 'bri',
        'destination_account' => '591201015454531',
        'destination_name'    => 'Puput Candra',
        'note'                => 'Pembayaran gaji',
    ])
]);
echo "Transfer ID: " . $tf['data']['id'] . "\\n";
echo "Status: "      . $tf['data']['status'] . "\\n";

// ── Cek status transfer
$id     = $tf['data']['id'];
$detail = disbursementApi("$base/disbursements/$id", $api_key);
echo "Status: " . $detail['data']['status'] . "\\n"; // pending → processing → success`

  const goCode = `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const (
	apiKey = "sk_live_xxxx..."
	base   = "https://api.sayabayar.com/v1"
)

func apiCall(method, url string, body interface{}) map[string]interface{} {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, url, reader)
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()
	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	return result
}

func main() {
	// ── Cek saldo
	bal := apiCall("GET", base+"/disbursements/balance", nil)
	fmt.Println("Saldo:", bal["data"].(map[string]interface{})["balance"])

	// ── Inquiry rekening
	inq := apiCall("POST", base+"/disbursements/inquiry", map[string]interface{}{
		"bank":           "bri",
		"account_number": "591201015454531",
	})
	fmt.Println("Nama:", inq["data"].(map[string]interface{})["account_name"])

	// ── Transfer (min Rp 10.000, fee Rp 2.500 otomatis)
	tf := apiCall("POST", base+"/disbursements/transfer", map[string]interface{}{
		"amount":              50000,
		"destination_bank":    "bri",
		"destination_account": "591201015454531",
		"destination_name":    "Puput Candra",
		"note":                "Pembayaran gaji",
	})
	data := tf["data"].(map[string]interface{})
	fmt.Println("Transfer ID:", data["id"], "Status:", data["status"])

	// ── Cek status transfer
	detail := apiCall("GET", base+"/disbursements/"+data["id"].(string), nil)
	fmt.Println("Status:", detail["data"].(map[string]interface{})["status"])
	// pending → processing → success
}`

  const codes = { curl: curlCode, node: nodeCode, php: phpCode, go: goCode }
  const activeCode = codes[tab] || curlCode

  return (
    <div className="card" style={{ padding: '20px 24px', marginTop: 24 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, color: 'inherit', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(99,102,241,0.12)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Code size={16} /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Disbursement API</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Integrasi transfer via API key Anda</div>
          </div>
        </div>
        {open ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
      </button>

      {open && (
        <div style={{ marginTop: 20 }}>

          {/* Auth info */}
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', marginBottom: 16, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <strong style={{ color: '#818cf8' }}>Autentikasi:</strong> Sertakan header <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4, fontSize: '0.78rem' }}>X-API-Key: sk_live_xxxx...</code> di setiap request. Buat API key di halaman <strong>API Keys</strong>.
          </div>

          {/* Endpoint reference */}
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Endpoint</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
            {endpoints.map(e => (
              <div key={`${e.method}-${e.path}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                  background: e.method === 'POST' ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)',
                  color: e.method === 'POST' ? '#10b981' : '#818cf8',
                }}>{e.method}</span>
                <code style={{ fontSize: '0.78rem', color: 'var(--text-primary)', flexShrink: 0 }}>{e.path}</code>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>— {e.desc}</span>
              </div>
            ))}
          </div>

          {/* Code examples */}
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Contoh Penggunaan</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 0 }}>
            {[['curl', 'cURL'], ['node', 'Node.js'], ['php', 'PHP'], ['go', 'Go']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{
                  padding: '6px 14px', borderRadius: '6px 6px 0 0', fontSize: '0.78rem', border: 'none', cursor: 'pointer',
                  fontWeight: tab === key ? 700 : 400,
                  background: tab === key ? 'var(--bg-input)' : 'transparent',
                  color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: tab === key ? '2px solid #818cf8' : '2px solid transparent',
                }}>{label}</button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => copyCode(activeCode)}
              style={{ position: 'absolute', top: 8, right: 8, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              {copied ? <><Check size={10} style={{ color: '#10b981' }} /> Copied</> : <><Copy size={10} /> Copy</>}
            </button>
            <pre style={{ background: 'var(--bg-input)', padding: '14px', paddingRight: 80, fontSize: '0.75rem', margin: 0, lineHeight: 1.7, borderRadius: '0 8px 8px 8px', overflowX: 'auto', maxHeight: 400 }}>
              {activeCode}
            </pre>
          </div>

          {/* Response examples */}
          <ResponseTabs />

          {/* Important notes */}
          <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            ⚠️ <strong style={{ color: '#f59e0b' }}>Catatan:</strong><br />
            • Minimal transfer <strong>Rp 10.000</strong>, biaya transfer <strong>Rp 2.500</strong> (di bawah Rp 250.000) atau <strong>Rp 3.000</strong> (Rp 250.000 ke atas)<br />
            • Status transfer: <code>pending</code> → <code>processing</code> → <code>success</code> / <code>failed</code><br />
            • Jika gagal, saldo otomatis dikembalikan<br />
            • Inquiry wajib dilakukan sebelum transfer untuk validasi rekening
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════
const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' }
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }
const uploadBoxStyle = { borderRadius: 12, border: '2px dashed var(--border)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden', transition: 'border-color 0.2s' }
const removeImgBtn = { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const overlayStyle = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const modalStyle = { background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'visible' }
const modalHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }
