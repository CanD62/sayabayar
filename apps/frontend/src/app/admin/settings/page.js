'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Zap, ZapOff, RefreshCw, Edit2, X, Check, Eye, EyeOff, AlertTriangle } from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

export default function AdminSettingsPage() {
  const toast = useToast()
  const [provider, setProvider] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showPin, setShowPin]     = useState(false)
  const [form, setForm] = useState({ email: '', user_id: '', token: '', pin: '' })

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/v1/admin/provider')
      setProvider(r.data)
    } catch {
      // provider belum ada
      setProvider(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openEdit = () => {
    setForm({ email: provider?.email || '', user_id: provider?.user_id || '', token: '', pin: '' })
    setShowToken(false)
    setShowPin(false)
    setShowEdit(true)
  }

  const handleSave = async () => {
    // Remove empty fields — only send what changed
    const payload = {}
    if (form.email.trim())   payload.email   = form.email.trim()
    if (form.user_id.trim()) payload.user_id = form.user_id.trim()
    if (form.token.trim())   payload.token   = form.token.trim()
    if (form.pin.trim())     payload.pin     = form.pin.trim()

    if (Object.keys(payload).length === 0) {
      toast.error('Tidak ada perubahan yang diisi')
      return
    }

    if (payload.pin && !/^\d{6}$/.test(payload.pin)) {
      toast.error('PIN harus 6 digit angka')
      return
    }

    setSaving(true)
    try {
      const r = await api.patch('/v1/admin/provider', payload)
      toast.success(r.data.message || 'Konfigurasi berhasil diperbarui')
      setProvider(r.data)
      setShowEdit(false)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleAutoProcess = async () => {
    setToggling(true)
    try {
      const res = await api.patch('/v1/admin/provider/auto-process', { enabled: !provider.auto_process })
      toast.success(res.data.message)
      setProvider(p => ({ ...p, auto_process: res.data.auto_process }))
    } catch (e) {
      toast.error(e.message)
    } finally {
      setToggling(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" /></div>

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengaturan Platform</h1>
          <p className="page-subtitle">Konfigurasi Flip payment provider</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={load} className="btn btn-ghost" style={{ gap: 8 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openEdit} className="btn btn-primary" style={{ gap: 8 }}>
            <Edit2 size={14} /> Edit Konfigurasi
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 560 }}>
        {/* Provider belum ada */}
        {!provider && (
          <div style={{
            padding: 24, borderRadius: 14, marginBottom: 20,
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Provider belum dikonfigurasi</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Flip payment provider belum ada di database. Klik "Edit Konfigurasi" untuk memasukkan token dan PIN.
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Flip Payment Provider
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              ['Email Flip', provider?.email || '—'],
              ['User ID', provider?.user_id || '—'],
              ['Saldo Flip', provider?.balance != null ? `Rp ${fmt(provider.balance)}` : '—'],
              ['Bearer Token', provider?.has_token ? '••••••••••••••••••• (tersimpan)' : '— belum diset'],
              ['PIN', provider?.has_pin ? '••••••  (tersimpan)' : '— belum diset'],
              ['Token Berlaku Hingga', provider?.token_expires_at ? new Date(provider.token_expires_at).toLocaleString('id-ID') : '— (akan refresh saat digunakan)'],
              ['Terakhir Diperbarui', provider?.updated_at ? new Date(provider.updated_at).toLocaleString('id-ID') : '—'],
            ].map(([label, val], i, arr) => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0',
                borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{label}</span>
                <span style={{
                  fontWeight: 600, fontSize: '0.82rem', fontFamily: label.includes('Token') || label.includes('PIN') ? 'monospace' : 'inherit',
                  color: val.toString().includes('belum') ? '#ef4444' : 'var(--text-primary)',
                }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Auto-process toggle */}
          {provider && (
            <div style={{
              marginTop: 24, padding: '16px 20px', borderRadius: 12,
              background: provider.auto_process ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${provider.auto_process ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {provider.auto_process
                      ? <><Zap size={16} color="#10b981" /> Transfer Otomatis <span style={{ color: '#10b981' }}>AKTIF</span></>
                      : <><ZapOff size={16} color="#ef4444" /> Transfer Otomatis <span style={{ color: '#ef4444' }}>NONAKTIF</span></>}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {provider.auto_process
                      ? 'Withdrawal langsung diproses ke Flip saat merchant submit.'
                      : 'Withdrawal memerlukan persetujuan manual admin.'}
                  </div>
                </div>
                <button
                  className={`btn ${provider.auto_process ? 'btn-danger' : 'btn-primary'}`}
                  onClick={toggleAutoProcess}
                  disabled={toggling}
                  style={{ flexShrink: 0, marginLeft: 16 }}
                >
                  {toggling ? 'Memproses...' : provider.auto_process ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Edit Konfigurasi Flip</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(false)}><X size={18} /></button>
            </div>

            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 20,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              fontSize: '0.78rem', color: '#f59e0b',
            }}>
              ⚠ Kosongkan field yang tidak ingin diubah. Token & PIN akan dienkripsi sebelum disimpan.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Email */}
              <div className="form-group">
                <label className="form-label">Email Flip</label>
                <input
                  type="email" className="form-input"
                  placeholder={provider?.email || 'email@flip.id'}
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {/* User ID */}
              <div className="form-group">
                <label className="form-label">User ID Flip</label>
                <input
                  type="text" className="form-input"
                  placeholder={provider?.user_id || 'ID numerik dari Flip'}
                  value={form.user_id}
                  onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Digunakan untuk mengecek saldo Aladin wallet.
                </p>
              </div>

              {/* Bearer Token */}
              <div className="form-group">
                <label className="form-label">Bearer Token</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showToken ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Token Bearer dari akun Flip..."
                    value={form.token}
                    onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                    style={{ paddingRight: 40, fontFamily: 'monospace', fontSize: '0.78rem' }}
                  />
                  <button type="button" onClick={() => setShowToken(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {provider?.has_token ? '✓ Token tersimpan — kosongkan jika tidak ingin mengubah.' : '⚠ Belum ada token. Wajib diisi.'}
                </p>
              </div>

              {/* PIN */}
              <div className="form-group">
                <label className="form-label">PIN Flip (6 digit)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPin ? 'text' : 'password'}
                    className="form-input"
                    placeholder="123456"
                    value={form.pin}
                    onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    maxLength={6}
                    style={{ paddingRight: 40, fontFamily: 'monospace', letterSpacing: '0.15em' }}
                  />
                  <button type="button" onClick={() => setShowPin(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                    {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {provider?.has_pin ? '✓ PIN tersimpan — kosongkan jika tidak ingin mengubah.' : '⚠ Belum ada PIN. Wajib diisi.'}
                </p>
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setShowEdit(false)}>Batal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ gap: 8 }}>
                {saving ? 'Menyimpan...' : <><Check size={14} /> Simpan Konfigurasi</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
