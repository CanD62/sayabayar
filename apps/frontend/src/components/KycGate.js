'use client'
import { useState, useEffect } from 'react'
import { ShieldCheck, Camera, FileText, Upload, Loader2, X, AlertTriangle, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { DISBURSEMENT } from '@/lib/disbursement'

// ─── Styles ───────────────────────────────────────────────
const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }
const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }
const uploadBoxStyle = { border: '2px dashed var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-input)', transition: 'border-color 0.2s' }
const removeImgBtn = { position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }

// ─── Purpose config ────────────────────────────────────────
const PURPOSE_COPY = {
  disbursement: {
    subtitle: 'Untuk menggunakan fitur Disbursement, Anda perlu menyelesaikan verifikasi KYC.',
    pendingTitle: 'Menunggu Verifikasi',
    pendingDesc: 'Dokumen KYC Anda sedang dalam proses review oleh tim kami.',
  },
  withdrawal: {
    subtitle: `Pendapatan Anda telah melebihi Rp ${new Intl.NumberFormat('id-ID').format(DISBURSEMENT.KYC_THRESHOLD)}. Verifikasi identitas diperlukan untuk menarik dana.`,
    pendingTitle: 'Verifikasi Sedang Diproses',
    pendingDesc: 'Dokumen KYC Anda sedang diverifikasi. Penarikan dana akan tersedia setelah disetujui.',
  },
}

// ─── KycForm — form upload KTP + selfie ───────────────────
function KycForm({ kycStatus, rejectionReason, onSubmitted }) {
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
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Pastikan kertas &amp; wajah terlihat jelas</span>
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

// ─── KycPendingState — UI saat KYC sedang direview ─────────
function KycPendingState({ copy }) {
  return (
    <div style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <Clock size={28} style={{ color: '#f59e0b' }} />
      </div>
      <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 8px' }}>{copy.pendingTitle}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 16 }}>
        {copy.pendingDesc}<br />Estimasi: 1×24 jam kerja.
      </p>
      <div style={{ padding: '12px 20px', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#f59e0b', fontWeight: 600 }}>
        <Loader2 size={14} className="spin" /> Menunggu review admin...
      </div>
    </div>
  )
}

/**
 * KycGate — Reusable component untuk blokir fitur sampai KYC approved.
 *
 * Props:
 *   purpose       'disbursement' | 'withdrawal'   — menentukan teks konteks
 *   children      React node — konten yang ditampilkan jika KYC approved
 *   loadingSlot   React node — (opsional) tampilan saat loading
 *
 * Cara pakai:
 *   <KycGate purpose="withdrawal">
 *     <WithdrawButton />
 *   </KycGate>
 *
 * Jika approved → render children
 * Jika pending  → render pending state
 * Jika null/rejected → render form KYC
 */
export default function KycGate({ purpose = 'disbursement', children, loadingSlot }) {
  const [kycData, setKycData] = useState(null)
  const [loading, setLoading] = useState(true)

  const copy = PURPOSE_COPY[purpose] || PURPOSE_COPY.disbursement

  const loadKyc = async () => {
    try {
      const res = await api.get('/v1/kyc/status')
      setKycData(res.data)
    } catch {
      setKycData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadKyc() }, [])

  if (loading) {
    return loadingSlot ?? <div className="loading"><div className="spinner" /></div>
  }

  // ── KYC approved → render children ───────────────────────
  if (kycData?.kyc_status === 'approved') {
    return children
  }

  // ── KYC pending → tampil waiting state ───────────────────
  if (kycData?.kyc_status === 'pending') {
    return <KycPendingState copy={copy} />
  }

  // ── KYC null / rejected → tampil form ────────────────────
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <ShieldCheck size={28} style={{ color: '#6366f1' }} />
        </div>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 8px' }}>Verifikasi Identitas</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
          {copy.subtitle}
        </p>
      </div>
      <KycForm kycStatus={kycData?.kyc_status} rejectionReason={kycData?.rejection_reason} onSubmitted={loadKyc} />
    </div>
  )
}

/**
 * useKycStatus — hook untuk cek KYC status + total_earned dari parent component.
 * Berguna jika parent perlu tahu apakah KYC diperlukan sebelum render KycGate.
 *
 * Returns: { kycRequired, kycStatus, loading }
 *   kycRequired   boolean  — true jika total_earned >= threshold DAN belum approved
 *   kycStatus     string   — 'approved' | 'pending' | 'rejected' | null
 *   loading       boolean
 */
export function useKycStatus(totalEarned, threshold = DISBURSEMENT.KYC_THRESHOLD) {
  const [kycStatus, setKycStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const needsCheck = totalEarned >= threshold

  useEffect(() => {
    if (!needsCheck) return
    setLoading(true)
    api.get('/v1/kyc/status')
      .then(res => setKycStatus(res.data?.kyc_status ?? null))
      .catch(() => setKycStatus(null))
      .finally(() => setLoading(false))
  }, [needsCheck])

  return {
    kycRequired: needsCheck && kycStatus !== 'approved',
    kycStatus,
    loading,
  }
}
