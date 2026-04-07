'use client'
import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import {
  Zap, ZapOff, RefreshCw, Edit2, X, Check, Eye, EyeOff,
  AlertTriangle, FlaskConical, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp, CreditCard,
  Wifi, WifiOff, RotateCcw, LogIn, Smartphone, MessageSquare, KeyRound, ShieldCheck
} from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))
const fmtSec = (s) => {
  if (s <= 0) return 'Expired'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}h ${h % 24}j`
  if (h > 0) return `${h}j ${m}m`
  return `${m}m ${s % 60}d`
}

// ── Komponen hasil uji coba per-baris ──────────────────────
function TestRow({ label, result, expanded, onToggle, detail }) {
  if (!result) return null
  const ok = result.ok !== false
  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
      background: ok ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
      overflow: 'hidden',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {ok
            ? <CheckCircle2 size={15} color="#10b981" style={{ flexShrink: 0 }} />
            : <XCircle     size={15} color="#ef4444" style={{ flexShrink: 0 }} />
          }
          <span style={{ fontWeight: 600, fontSize: '0.82rem', color: ok ? '#10b981' : '#ef4444' }}>
            {label}
          </span>
          {detail && (
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              — {detail}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
      </button>
      {expanded && (
        <pre style={{
          margin: 0, padding: '0 14px 12px',
          fontSize: '0.72rem', color: 'var(--text-muted)',
          overflowX: 'auto',
          fontFamily: 'ui-monospace, monospace',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: 10,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function AdminSettingsPage() {
  const toast = useToast()
  const [provider, setProvider] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [showToken, setShowToken]   = useState(false)
  const [showPin, setShowPin]       = useState(false)
  const [showRefresh, setShowRefresh] = useState(false)
  const [form, setForm] = useState({ email: '', user_id: '', token: '', refresh_token: '', pin: '' })

  // ── Test connection state ──────────────────────────────────
  const [testing, setTesting]     = useState(false)
  const [testResults, setTestResults] = useState(null)
  const [testError, setTestError] = useState(null)
  const [testForm, setTestForm]   = useState({ account_number: '', bank: '' })
  const [expanded, setExpanded]   = useState({})

  // ── Manual refresh state ──────────────────────────────────
  const [refreshing, setRefreshing] = useState(false)

  // ── Flip Login Wizard state ───────────────────────────────
  const [showLogin, setShowLogin]     = useState(false)
  const [loginStep, setLoginStep]     = useState(0)  // 0=phone, 1=otp, 2=pin, 3=done
  const [loginBusy, setLoginBusy]     = useState(false)
  const [loginInfo, setLoginInfo]     = useState(null) // info dari /check
  const [loginForm, setLoginForm]     = useState({ credential: '', otp: '', pin: '' })
  const [showLoginPin, setShowLoginPin] = useState(false)
  const otpRef = useRef(null)

  // ── Alaflip Activation state ────────────────────────────
  const [activating, setActivating]   = useState(false)
  const [activateResult, setActivateResult] = useState(null) // { ok, message, job_id }

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/v1/admin/provider')
      setProvider(r.data)
    } catch {
      setProvider(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openEdit = () => {
    setForm({ email: provider?.email || '', user_id: provider?.user_id || '', token: '', refresh_token: '', pin: '' })
    setShowToken(false); setShowPin(false); setShowRefresh(false)
    setShowEdit(true)
  }

  const handleSave = async () => {
    const payload = {}
    if (form.email.trim())         payload.email         = form.email.trim()
    if (form.user_id.trim())       payload.user_id       = form.user_id.trim()
    if (form.token.trim())         payload.token         = form.token.trim()
    if (form.refresh_token.trim()) payload.refresh_token = form.refresh_token.trim()
    if (form.pin.trim())           payload.pin           = form.pin.trim()

    if (Object.keys(payload).length === 0) { toast.error('Tidak ada perubahan yang diisi'); return }
    if (payload.pin && !/^\d{6}$/.test(payload.pin)) { toast.error('PIN harus 6 digit angka'); return }

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

  const handleRefreshToken = async () => {
    setRefreshing(true)
    try {
      const r = await api.post('/v1/admin/provider/refresh-token', {})
      toast.success(`Token diperbarui — expires: ${new Date(r.data.expires_at).toLocaleString('id-ID')}`)
      await load()
    } catch (e) {
      toast.error(`Gagal refresh: ${e.message}`)
    } finally {
      setRefreshing(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResults(null)
    setTestError(null)
    setExpanded({})
    try {
      const body = {}
      if (testForm.account_number.trim() && testForm.bank.trim()) {
        body.account_number = testForm.account_number.trim()
        body.bank           = testForm.bank.trim()
      }
      const r = await api.post('/v1/admin/provider/test-connection', body)
      setTestResults(r.data)
    } catch (e) {
      setTestError(e.message)
    } finally {
      setTesting(false)
    }
  }

  const toggleExpand = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }))

  // ── Flip Login Wizard handlers ────────────────────────────
  const openLoginWizard = () => {
    setLoginStep(0)
    setLoginForm({ credential: '', otp: '', pin: '' })
    setLoginInfo(null)
    setShowLoginPin(false)
    setShowLogin(true)
  }

  const handleLoginCheck = async () => {
    if (!loginForm.credential.trim()) { toast.error('Masukkan nomor HP atau email'); return }
    setLoginBusy(true)
    try {
      const r = await api.post('/v1/admin/flip-login/check', { credential: loginForm.credential.trim() })
      setLoginInfo(r.data)
      setLoginStep(1)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoginBusy(false)
    }
  }

  const handleRequestOtp = async () => {
    setLoginBusy(true)
    try {
      const r = await api.post('/v1/admin/flip-login/request-otp', { credential: loginForm.credential.trim() })
      toast.success(r.data.message)
      setLoginStep(2)
      setTimeout(() => otpRef.current?.focus(), 100)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoginBusy(false)
    }
  }

  const handleVerifyOtp = async () => {
    if (!loginForm.otp.trim()) { toast.error('Masukkan kode OTP'); return }
    setLoginBusy(true)
    try {
      await api.post('/v1/admin/flip-login/verify-otp', {
        credential: loginForm.credential.trim(),
        otp:        loginForm.otp.trim(),
      })
      setLoginStep(3)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoginBusy(false)
    }
  }

  const handleFinalizeLogin = async () => {
    if (!loginForm.pin.trim()) { toast.error('Masukkan PIN Flip'); return }
    setLoginBusy(true)
    try {
      const r = await api.post('/v1/admin/flip-login/finalize', { pin: loginForm.pin.trim() })
      toast.success(r.data.message)
      setLoginStep(4) // done
      await load()    // reload provider info
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoginBusy(false)
    }
  }

  const handleActivateAlaflip = async () => {
    setActivating(true)
    setActivateResult(null)
    toast.info('Memulai aktivasi Alaflip... (30–90 detik)', { duration: 120_000 })
    try {
      const r = await api.post('/v1/admin/flip-login/activate-alaflip', {})
      setActivateResult({ ok: true, message: r.data.message })
      toast.success(r.data.message)
    } catch (e) {
      setActivateResult({ ok: false, message: e.message })
      toast.error(e.message)
    } finally {
      setActivating(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" /></div>

  const tokenExpiry = provider?.token_expires_at ? new Date(provider.token_expires_at) : null
  const tokenExpiredSoon = tokenExpiry && (tokenExpiry - Date.now()) < 2 * 60 * 60 * 1000

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengaturan Platform</h1>
          <p className="page-subtitle">Konfigurasi Flip payment provider</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={load} className="btn btn-ghost" style={{ gap: 8 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openLoginWizard} className="btn btn-ghost" style={{ gap: 8, borderColor: 'rgba(99,102,241,0.4)', color: '#6366f1' }}>
            <LogIn size={14} /> Login Flip
          </button>
          {provider && (
            <button
              onClick={handleActivateAlaflip}
              disabled={activating}
              className="btn btn-ghost"
              style={{ gap: 8, borderColor: 'rgba(16,185,129,0.4)', color: '#10b981' }}
            >
              {activating
                ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Mengirim...</>
                : <><ShieldCheck size={14} /> Aktivasi Alaflip</>
              }
            </button>
          )}
          <button onClick={openEdit} className="btn btn-primary" style={{ gap: 8 }}>
            <Edit2 size={14} /> Edit Konfigurasi
          </button>
        </div>
      </div>

      {/* Banner hasil aktivasi Alaflip */}
      {activateResult && (
        <div style={{
          maxWidth: 620,
          padding: '12px 16px', borderRadius: 10,
          background: activateResult.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${activateResult.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem'
        }}>
          {activateResult.ok
            ? <CheckCircle2 size={16} color="#10b981" />
            : <AlertTriangle size={16} color="#ef4444" />}
          <span style={{ color: activateResult.ok ? '#10b981' : '#ef4444' }}>
            {activateResult.message}
          </span>
          <button onClick={() => setActivateResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>×</button>
        </div>
      )}

      <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Warning: provider belum ada */}
        {!provider && (
          <div style={{
            padding: 24, borderRadius: 14,
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Provider belum dikonfigurasi</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Klik "Edit Konfigurasi" untuk memasukkan token, refresh token, dan PIN dari akun Flip.
              </div>
            </div>
          </div>
        )}

        {/* Kartu info provider */}
        <div className="card" style={{ padding: 28 }}>
          <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 18 }}>
            Flip Payment Provider
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              ['Email Flip',     provider?.email   || '—'],
              ['User ID',        provider?.user_id || '—'],
              ['Saldo Flip',     provider?.balance != null ? `Rp ${fmt(provider.balance)}` : '—'],
              ['Bearer Token',   provider?.has_token   ? '••••••••••••••••••• (tersimpan)' : '— belum diset'],
              ['Refresh Token',  provider?.has_refresh ? '•••••••••••• (tersimpan)' : '— belum diset'],
              ['PIN',            provider?.has_pin     ? '••••••  (tersimpan)' : '— belum diset'],
              ['Token Berlaku',  tokenExpiry
                ? <span style={{ color: tokenExpiredSoon ? '#f59e0b' : 'var(--text-primary)' }}>
                    {tokenExpiry.toLocaleString('id-ID')}
                    {tokenExpiredSoon && ' ⚠ segera habis'}
                  </span>
                : '— (akan refresh saat digunakan)'],
              ['Diperbarui',     provider?.updated_at ? new Date(provider.updated_at).toLocaleString('id-ID') : '—'],
            ].map(([label, val], i, arr) => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '11px 0',
                borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{label}</span>
                <span style={{
                  fontWeight: 600, fontSize: '0.82rem',
                  fontFamily: ['Bearer Token','Refresh Token','PIN'].includes(label) ? 'monospace' : 'inherit',
                  color: val?.toString?.().includes?.('belum') ? '#ef4444' : 'var(--text-primary)',
                }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Tombol Refresh Token manual */}
          {provider?.has_token && (
            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button
                onClick={handleRefreshToken}
                disabled={refreshing}
                className="btn btn-ghost"
                style={{ gap: 8, fontSize: '0.8rem' }}
              >
                {refreshing
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Merefresh...</>
                  : <><RotateCcw size={14} /> Refresh Token Sekarang</>
                }
              </button>
            </div>
          )}

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

        {/* ══ Seksi Uji Coba API ══════════════════════════════ */}
        <div className="card" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <FlaskConical size={16} color="#6366f1" />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Uji Coba Koneksi Flip API
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Klik tombol di bawah untuk menguji token yang tersimpan, refresh token, ambil list bank, dan cek saldo Alaflip secara berurutan.
          </p>

          {/* Form cek rekening opsional */}
          <div style={{
            padding: '14px 16px', borderRadius: 10, marginBottom: 16,
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600 }}>
              <CreditCard size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Cek Rekening (Opsional)
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Nomor rekening"
                value={testForm.account_number}
                onChange={e => setTestForm(f => ({ ...f, account_number: e.target.value.replace(/\D/g, '') }))}
                style={{ flex: 2, fontSize: '0.82rem' }}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Kode bank (bca, bni...)"
                value={testForm.bank}
                onChange={e => setTestForm(f => ({ ...f, bank: e.target.value.toLowerCase().trim() }))}
                style={{ flex: 1, fontSize: '0.82rem' }}
              />
            </div>
          </div>

          <button
            onClick={handleTest}
            disabled={testing || !provider?.has_token}
            className="btn btn-primary"
            style={{ gap: 8, width: '100%', justifyContent: 'center', marginBottom: 20 }}
          >
            {testing
              ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Menguji koneksi...</>
              : <><Wifi size={15} /> Jalankan Uji Coba</>
            }
          </button>

          {!provider?.has_token && (
            <div style={{ fontSize: '0.78rem', color: '#f59e0b', textAlign: 'center', marginTop: -12, marginBottom: 16 }}>
              ⚠ Token belum dikonfigurasi
            </div>
          )}

          {/* Error */}
          {testError && (
            <div style={{
              padding: '12px 14px', borderRadius: 10, marginBottom: 12,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              display: 'flex', gap: 8, alignItems: 'center',
              fontSize: '0.8rem', color: '#ef4444',
            }}>
              <WifiOff size={14} /> {testError}
            </div>
          )}

          {/* Hasil */}
          {testResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Hasil Uji Coba
              </div>

              <TestRow
                label="Token JWT"
                result={testResults.token_info}
                expanded={expanded.token_info}
                onToggle={() => toggleExpand('token_info')}
                detail={testResults.token_info?.ok
                  ? `${testResults.token_info.email || '—'} | device: ${testResults.token_info.device_identifier?.slice(0,8)}... | sisa: ${fmtSec(testResults.token_info.seconds_remaining)}`
                  : testResults.token_info?.error
                }
              />

              <TestRow
                label="Refresh Token"
                result={testResults.refresh}
                expanded={expanded.refresh}
                onToggle={() => toggleExpand('refresh')}
                detail={testResults.refresh?.ok
                  ? `expires: ${testResults.refresh.expires_at ? new Date(testResults.refresh.expires_at).toLocaleString('id-ID') : '—'}`
                  : testResults.refresh?.error
                }
              />

              <TestRow
                label="List Bank"
                result={testResults.bank_list}
                expanded={expanded.bank_list}
                onToggle={() => toggleExpand('bank_list')}
                detail={testResults.bank_list?.ok
                  ? `${testResults.bank_list.count} bank/ewallet`
                  : testResults.bank_list?.error
                }
              />

              <TestRow
                label="Saldo Alaflip"
                result={testResults.alaflip_balance}
                expanded={expanded.alaflip_balance}
                onToggle={() => toggleExpand('alaflip_balance')}
                detail={testResults.alaflip_balance?.ok
                  ? `Rp ${fmt(testResults.alaflip_balance.balance ?? 0)} | status: ${testResults.alaflip_balance.status || '—'}`
                  : testResults.alaflip_balance?.error
                }
              />

              {testResults.check_account && (
                <TestRow
                  label="Cek Rekening"
                  result={testResults.check_account}
                  expanded={expanded.check_account}
                  onToggle={() => toggleExpand('check_account')}
                  detail={testResults.check_account?.ok
                    ? `${testResults.check_account.account_name} (${testResults.check_account.bank})`
                    : testResults.check_account?.error
                  }
                />
              )}

              {/* Summary */}
              <div style={{
                marginTop: 8, padding: '10px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: '0.78rem',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {Object.values(testResults).filter(v => v?.ok).length} / {Object.keys(testResults).length} berhasil
                </span>
                <button
                  onClick={() => { setTestResults(null); setTestError(null) }}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.72rem', gap: 4 }}
                >
                  <X size={11} /> Hapus hasil
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══ Edit Modal ══════════════════════════════════════════ */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Edit Konfigurasi Flip</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(false)}><X size={18} /></button>
            </div>

            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 20,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              fontSize: '0.78rem', color: '#f59e0b',
            }}>
              ⚠ Kosongkan field yang tidak ingin diubah. Token &amp; PIN dienkripsi sebelum disimpan.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Email */}
              <div className="form-group">
                <label className="form-label">Email Flip</label>
                <input type="email" className="form-input"
                  placeholder={provider?.email || 'email@flip.id'}
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {/* User ID */}
              <div className="form-group">
                <label className="form-label">User ID Flip</label>
                <input type="text" className="form-input"
                  placeholder={provider?.user_id || 'ID numerik dari Flip'}
                  value={form.user_id}
                  onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Digunakan untuk cek saldo &amp; status Alaflip.
                </p>
              </div>

              {/* Bearer Token */}
              <div className="form-group">
                <label className="form-label">Bearer Token (Access Token)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showToken ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Token Bearer dari akun Flip (eyJ...)"
                    value={form.token}
                    onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                    style={{ paddingRight: 40, fontFamily: 'monospace', fontSize: '0.76rem' }}
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

              {/* Refresh Token */}
              <div className="form-group">
                <label className="form-label">Refresh Token</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showRefresh ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Refresh token dari Flip (SmhU...)"
                    value={form.refresh_token}
                    onChange={e => setForm(f => ({ ...f, refresh_token: e.target.value }))}
                    style={{ paddingRight: 40, fontFamily: 'monospace', fontSize: '0.76rem' }}
                  />
                  <button type="button" onClick={() => setShowRefresh(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                    {showRefresh ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {provider?.has_refresh ? '✓ Refresh token tersimpan — kosongkan jika tidak ingin mengubah.' : '⚠ Belum ada refresh token.'}
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

      {/* ══ Flip Login Wizard Modal ══════════════════════════ */}
      {showLogin && (
        <div className="modal-overlay" onClick={() => !loginBusy && setShowLogin(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <LogIn size={17} color="#6366f1" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Login Flip</div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>Token tersimpan otomatis</div>
                </div>
              </div>
              {!loginBusy && <button className="btn btn-ghost btn-sm" onClick={() => setShowLogin(false)}><X size={18} /></button>}
            </div>

            {/* Step indicator */}
            {loginStep < 4 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
                {[
                  { icon: Smartphone,    label: 'Nomor' },
                  { icon: MessageSquare, label: 'Kirim OTP' },
                  { icon: MessageSquare, label: 'Kode OTP' },
                  { icon: KeyRound,      label: 'PIN' },
                ].map((s, i) => {
                  const Icon = s.icon
                  const done    = i < loginStep
                  const current = i === loginStep
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: done ? '#10b981' : current ? '#6366f1' : 'rgba(255,255,255,0.06)',
                          border: `1.5px solid ${done ? '#10b981' : current ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                          transition: 'all 0.2s',
                        }}>
                          {done
                            ? <Check size={13} color="#fff" />
                            : <span style={{ fontSize: '0.68rem', fontWeight: 700, color: current ? '#fff' : 'var(--text-muted)' }}>{i + 1}</span>
                          }
                        </div>
                        <span style={{ fontSize: '0.62rem', color: current ? '#6366f1' : done ? '#10b981' : 'var(--text-muted)', fontWeight: current ? 600 : 400 }}>
                          {s.label}
                        </span>
                      </div>
                      {i < 3 && <div style={{ height: 1, flex: 0.5, background: done ? '#10b981' : 'rgba(255,255,255,0.08)', marginBottom: 18 }} />}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Step 0: Cek nomor HP ── */}
            {loginStep === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
                  fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5,
                }}>
                  Masukkan nomor HP atau email akun Flip. Sistem akan mengecek akun dan mengirim kode OTP via WhatsApp.
                </div>
                <div className="form-group">
                  <label className="form-label">Nomor HP / Email</label>
                  <input
                    type="text" className="form-input"
                    placeholder="+628xxxxxxxxxx atau email@flip.id"
                    value={loginForm.credential}
                    onChange={e => setLoginForm(f => ({ ...f, credential: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleLoginCheck()}
                    autoFocus
                  />
                </div>
                <button
                  className="btn btn-primary" onClick={handleLoginCheck} disabled={loginBusy}
                  style={{ gap: 8, justifyContent: 'center' }}
                >
                  {loginBusy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Memeriksa...</> : <>Cek Akun →</>}
                </button>
              </div>
            )}

            {/* ── Step 1: Konfirmasi & minta OTP ── */}
            {loginStep === 1 && loginInfo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  padding: '14px 16px', borderRadius: 12,
                  background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
                }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Akun ditemukan
                  </div>
                  {[
                    ['Nomor HP', loginInfo.phone_masked],
                    ['Email',    loginInfo.email_masked],
                    ['PIN',      loginInfo.is_pin_registered ? '✅ Sudah terdaftar' : '❌ Belum'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Kode OTP akan dikirim ke WhatsApp nomor {loginInfo.phone_masked}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={() => setLoginStep(0)} style={{ flex: 1 }} disabled={loginBusy}>
                    ← Ganti Nomor
                  </button>
                  <button className="btn btn-primary" onClick={handleRequestOtp} disabled={loginBusy} style={{ flex: 2, gap: 8, justifyContent: 'center' }}>
                    {loginBusy
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Mengirim...</>
                      : <><MessageSquare size={14} /> Kirim OTP via WA</>
                    }
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Input kode OTP ── */}
            {loginStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)',
                  fontSize: '0.78rem', color: '#f59e0b', display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  <MessageSquare size={13} />
                  Cek WhatsApp Anda. Masukkan kode OTP yang diterima.
                </div>
                <div className="form-group">
                  <label className="form-label">Kode OTP</label>
                  <input
                    ref={otpRef}
                    type="text" className="form-input"
                    placeholder="123456"
                    value={loginForm.otp}
                    onChange={e => setLoginForm(f => ({ ...f, otp: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                    onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                    style={{ fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: '0.25em', textAlign: 'center' }}
                    maxLength={8}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={handleRequestOtp} disabled={loginBusy} style={{ flex: 1, fontSize: '0.78rem' }}>
                    Kirim ulang
                  </button>
                  <button className="btn btn-primary" onClick={handleVerifyOtp} disabled={loginBusy || !loginForm.otp} style={{ flex: 2, gap: 8, justifyContent: 'center' }}>
                    {loginBusy
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Memverifikasi...</>
                      : <>Verifikasi OTP →</>
                    }
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Input PIN ── */}
            {loginStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
                  fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  <ShieldCheck size={13} color="#6366f1" />
                  OTP terverifikasi! Masukkan PIN 6 digit akun Flip untuk menyelesaikan login.
                </div>
                <div className="form-group">
                  <label className="form-label">PIN Flip (6 digit)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showLoginPin ? 'text' : 'password'}
                      className="form-input"
                      placeholder="••••••"
                      value={loginForm.pin}
                      onChange={e => setLoginForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      onKeyDown={e => e.key === 'Enter' && handleFinalizeLogin()}
                      style={{ fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: '0.3em', textAlign: 'center', paddingRight: 44 }}
                      maxLength={6}
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowLoginPin(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                      {showLoginPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    PIN ini akan dienkripsi dan disimpan untuk keperluan aktivasi Alaflip.
                  </p>
                </div>
                <button
                  className="btn btn-primary" onClick={handleFinalizeLogin}
                  disabled={loginBusy || loginForm.pin.length < 6}
                  style={{ gap: 8, justifyContent: 'center' }}
                >
                  {loginBusy
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Memproses...</>
                    : <><ShieldCheck size={14} /> Selesaikan Login</>
                  }
                </button>
              </div>
            )}

            {/* ── Step 4: Sukses ── */}
            {loginStep === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0 4px' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CheckCircle2 size={32} color="#10b981" />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 6 }}>Login Berhasil!</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Token dan refresh token telah tersimpan ke database.<br />
                    Sistem siap memproses withdrawal otomatis via Flip.
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => setShowLogin(false)} style={{ marginTop: 8 }}>
                  Tutup
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  )
}
