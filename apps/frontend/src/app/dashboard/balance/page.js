'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowDownRight, Wallet, Clock, CircleDollarSign, Timer, CheckCircle2, Hourglass, Eye, EyeOff, CheckCircle, XCircle, ArrowUpRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { SkeletonStatGrid, SkeletonTable } from '@/components/Skeleton'
import { useInvoiceEvents } from '@/lib/InvoiceEventContext'
import { fmt } from '@/lib/format'
import { SUPPORTED_BANKS } from '@/lib/constants'
import BankSelect from '@/components/BankSelect'
import KycGate, { useKycStatus } from '@/components/KycGate'

// Format countdown from now until targetDate
function useCountdown(targetDate) {
  const [display, setDisplay] = useState('')
  useEffect(() => {
    if (!targetDate) return
    const tick = () => {
      const diff = new Date(targetDate) - Date.now()
      if (diff <= 0) { setDisplay('Siap cair'); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      if (d > 0) setDisplay(`${d}h ${h}j ${m}m`)
      else if (h > 0) setDisplay(`${h}j ${m}m ${s}d`)
      else setDisplay(`${m}m ${s}d`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetDate])
  return display
}

// Countdown cell — must be its own component so each row has its own hook
function CountdownCell({ availableAt, settled }) {
  const countdown = useCountdown(settled ? null : availableAt)
  if (settled) return <span style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 600 }}>✓ Settled</span>
  if (!availableAt) return null
  const isDue = new Date(availableAt) <= Date.now()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {new Date(availableAt).toLocaleString('id-ID')}
      </span>
      <span style={{
        fontSize: '0.72rem', fontWeight: 700,
        color: isDue ? 'var(--success)' : 'var(--warning)',
        display: 'flex', alignItems: 'center', gap: 3,
      }}>
        <Timer size={10} /> {isDue ? 'Siap cair' : countdown}
      </span>
    </div>
  )
}

// Reusable ledger table
function LedgerTable({ entries, showStatus = false }) {
  if (entries.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '24px 0' }}>
        <div className="empty-state-text" style={{ fontSize: '0.85rem' }}>Tidak ada data</div>
      </div>
    )
  }
  return (
    <>
      {/* Desktop table */}
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Amount</th>
            <th>Invoice</th>
            <th>Keterangan</th>
            <th>Waktu</th>
            {showStatus && <th>Status</th>}
          </tr></thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td style={{ fontWeight: 700 }}>Rp {fmt(e.amount)}</td>
                <td className="font-mono" style={{ fontSize: '0.78rem' }}>{e.invoice_number || '-'}</td>
                <td className="text-sm">{e.note || '-'}</td>
                <td className="text-sm text-muted">{new Date(e.created_at).toLocaleString('id-ID')}</td>
                {showStatus && (
                  <td><CountdownCell availableAt={e.available_at} settled={!!e.settled_at} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      {entries.map(e => (
        <div className="mobile-card" key={e.id}>
          <div className="mobile-card-header">
            <div>
              <div className="mobile-card-title">Rp {fmt(e.amount)}</div>
              {e.invoice_number && (
                <div className="font-mono" style={{ fontSize: '0.75rem', marginTop: 2, color: 'var(--text-muted)' }}>
                  {e.invoice_number}
                </div>
              )}
            </div>
            {showStatus && <CountdownCell availableAt={e.available_at} settled={!!e.settled_at} />}
          </div>
          {e.note && (
            <div className="mobile-card-row">
              <span className="mobile-card-label">Keterangan</span>
              <span className="text-sm">{e.note}</span>
            </div>
          )}
          <div className="mobile-card-row">
            <span className="mobile-card-label">Waktu</span>
            <span className="text-sm text-muted">{new Date(e.created_at).toLocaleString('id-ID')}</span>
          </div>
        </div>
      ))}
    </>
  )
}

export default function BalancePage() {
  const toast = useToast()
  const [balance, setBalance] = useState(null)
  const [ledgerAvailable, setLedgerAvailable] = useState([])
  const [ledgerPending, setLedgerPending] = useState([])
  const [ledgerDebit, setLedgerDebit] = useState([])
  const [loading, setLoading] = useState(true)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ amount: '', destination_bank: '', destination_account: '', destination_name: '', password: '' })
  const [formError, setFormError] = useState(null)

  // Lookup state
  const [banksLoading, setBanksLoading] = useState(false) // eslint-disable-line — kept for fallback
  const [acctChecking, setAcctChecking] = useState(false)
  const [acctChecked, setAcctChecked] = useState(null) // null | { account_name } | 'error'
  const [showPassword, setShowPassword] = useState(false)
  const [nonce, setNonce] = useState(null)
  const [nonceLoading, setNonceLoading] = useState(false)
  const checkTimerRef = useRef(null)
  const submittingRef = useRef(false) // guard double-submit (lebih cepat dari state)

  const invoiceEvents = useInvoiceEvents()

  const load = () => {
    Promise.all([
      api.get('/v1/balance'),
      api.get('/v1/balance/ledger?type=credit_available&per_page=50'),
      api.get('/v1/balance/ledger?type=credit_pending&per_page=50'),
      api.get('/v1/balance/ledger?type=debit_withdraw&per_page=50'),
    ])
      .then(([b, avail, pend, debit]) => {
        setBalance(b.data)
        setLedgerAvailable(avail.data)
        setLedgerPending(pend.data)
        setLedgerDebit(debit.data)
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  // KYC check — hanya dijalankan jika total_earned >= 250k
  const totalEarned = balance?.total_earned ?? 0
  const { kycRequired, kycStatus, loading: kycLoading } = useKycStatus(totalEarned)

  // Auto-refresh when balance.settled SSE event fires from layout
  useEffect(() => {
    if (!invoiceEvents) return
    return invoiceEvents.onEvent((eventName) => {
      if (eventName === 'balance.settled') load()
    })
  }, [invoiceEvents])

  const closeWithdraw = () => {
    setShowWithdraw(false)
    setFormError(null)
    setNonce(null)
    setAcctChecked(null)
    setShowPassword(false)
    setForm({ amount: '', destination_bank: '', destination_account: '', destination_name: '', password: '' })
  }

  // Fetch nonce (bisa dipanggil ulang untuk refresh)
  const fetchNonce = useCallback(async (silent = false) => {
    if (!silent) setNonceLoading(true)
    try {
      const res = await api.post('/v1/withdrawals/intent')
      setNonce(res.data.nonce)
      return res.data.nonce
    } catch (err) {
      if (!silent) {
        setShowWithdraw(false)
        const msg = err.code === 'WITHDRAWAL_DAILY_LIMIT'
          ? err.message
          : err.code === 'WITHDRAWAL_PENDING_EXISTS'
            ? err.message
            : 'Tidak dapat memulai penarikan. Coba beberapa saat lagi.'
        toast.error(msg)
      }
      return null
    } finally {
      if (!silent) setNonceLoading(false)
    }
  }, [])

  // Buka modal: ambil nonce
  const openWithdraw = async () => {
    setShowWithdraw(true)
    setFormError(null)
    setNonce(null)
    setAcctChecked(null)
    fetchNonce(false)
  }

  // Auto-refresh nonce setiap 4 menit saat form terbuka (nonce TTL = 5 menit)
  const nonceRefreshRef = useRef(null)
  useEffect(() => {
    if (!showWithdraw) return
    nonceRefreshRef.current = setInterval(() => {
      fetchNonce(true)  // silent refresh — user tidak perlu tahu
    }, 4 * 60 * 1000)  // 4 menit
    return () => clearInterval(nonceRefreshRef.current)
  }, [showWithdraw, fetchNonce])

  // Cek rekening dengan debounce 800ms
  const checkAccount = useCallback(async (accountNumber, bank) => {
    if (!accountNumber || accountNumber.length < 5 || !bank) return
    setAcctChecking(true)
    setAcctChecked(null)
    try {
      const res = await api.post('/v1/lookup/check-account', {
        account_number: accountNumber,
        bank
      })
      const name = res.data?.account_name
      setAcctChecked({ account_name: name })
      setForm(prev => ({ ...prev, destination_name: name || '' }))
    } catch (err) {
      setAcctChecked('error')
      setForm(prev => ({ ...prev, destination_name: '' }))
    } finally {
      setAcctChecking(false)
    }
  }, [])

  const handleWithdraw = async (e) => {
    e.preventDefault()
    if (submittingRef.current) return  // tolak double-submit
    setFormError(null)
    const amount = parseFloat(form.amount)
    const fee    = 2_500  // WITHDRAW.DEFAULT_FEE
    const totalDebit = amount + fee
    if (!amount || amount < 50_000) { setFormError('Minimal penarikan Rp 50.000 (belum termasuk biaya Rp 2.500)'); return }
    if (totalDebit > (balance?.balance_available || 0)) {
      setFormError(`Saldo tidak cukup. Perlu Rp ${fmt(totalDebit)} (Rp ${fmt(amount)} + biaya Rp 2.500), tersedia Rp ${fmt(balance?.balance_available || 0)}`)
      return
    }
    if (!form.destination_bank.trim()) { setFormError('Bank tujuan wajib diisi'); return }
    if (!form.destination_account.trim()) { setFormError('No. rekening wajib diisi'); return }
    if (acctChecked === 'error' || !acctChecked) { setFormError('Verifikasi nomor rekening terlebih dahulu'); return }
    if (!form.destination_name.trim()) { setFormError('Nama penerima wajib diisi'); return }
    if (!form.password.trim()) { setFormError('Password wajib diisi untuk konfirmasi penarikan'); return }
    // Jika nonce belum ada, coba fetch dulu (fallback safety)
    let activeNonce = nonce
    if (!activeNonce) {
      activeNonce = await fetchNonce(false)
      if (!activeNonce) return  // fetchNonce sudah handle error
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      await api.post('/v1/withdrawals', {
        amount,
        destination_bank:    form.destination_bank,
        destination_account: form.destination_account,
        destination_name:    form.destination_name,
        password:            form.password,
        nonce:               activeNonce
      })
      closeWithdraw()
      toast.success('Penarikan berhasil diajukan!')
      load()
    } catch (err) {
      if (err.code === 'WITHDRAWAL_NONCE_INVALID') {
        // Nonce expired saat submit — refresh otomatis, minta user coba lagi
        setNonce(null)
        fetchNonce(true)  // refresh di background
        setFormError('Sesi sempat habis. Nonce sudah diperbarui, silakan klik Konfirmasi Penarikan sekali lagi.')
      } else if (err.code === 'WITHDRAWAL_DAILY_LIMIT') {
        closeWithdraw()
        toast.error(err.message)
      } else if (err.code === 'INVALID_CREDENTIALS') {
        setFormError('Password yang Anda masukkan salah.')
      } else if (err.code === 'WITHDRAWAL_PASSWORD_LOCKED') {
        closeWithdraw()
        toast.error(err.message)
      } else {
        setFormError(err.message || 'Gagal melakukan penarikan')
      }
    } finally {
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  if (loading) return (<><SkeletonStatGrid count={3} /><SkeletonTable rows={5} cols={5} /></>)

  // Trigger cek rekening setelah nomor rekening + bank keduanya terisi
  const triggerCheck = (accountNumber, bank) => {
    clearTimeout(checkTimerRef.current)
    setAcctChecked(null)
    setForm(prev => ({ ...prev, destination_name: '' }))
    if (accountNumber.length >= 5 && bank) {
      checkTimerRef.current = setTimeout(() => checkAccount(accountNumber, bank), 800)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Saldo &amp; Penarikan</h1>
          <p className="page-subtitle">Kelola saldo dan tarik dana Anda</p>
        </div>
        <button className="btn btn-primary" onClick={openWithdraw}
          disabled={!balance?.balance_available || kycRequired || kycLoading}>
          <ArrowDownRight size={16} /> Tarik Dana
        </button>
      </div>

      {/* KYC Banner — muncul hanya jika total_earned >= 250k dan belum approved */}
      {kycRequired && (
        <div style={{ marginBottom: 20 }}>
          <KycGate purpose="withdrawal"
            loadingSlot={<div style={{ padding: '20px 0', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
          />
        </div>
      )}

      {/* Stat Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <Wallet size={32} className="stat-icon" />
          <div className="stat-label">Saldo Tersedia</div>
          <div className="stat-value">Rp {fmt(balance?.balance_available || 0)}</div>
          <div className="stat-suffix">Siap ditarik</div>
        </div>
        <div className="stat-card">
          <Clock size={32} className="stat-icon" />
          <div className="stat-label">Dana Pending</div>
          <div className="stat-value">Rp {fmt(balance?.balance_pending || 0)}</div>
          <div className="stat-suffix">Akan cair H+2</div>
        </div>
        <div className="stat-card">
          <CircleDollarSign size={32} className="stat-icon" />
          <div className="stat-label">Total Ditarik</div>
          <div className="stat-value">Rp {fmt(balance?.total_withdrawn || 0)}</div>
        </div>
      </div>

      {/* Dana Pending Section */}
      <div className="card mobile-cards">
        <div className="card-header" style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Hourglass size={18} style={{ color: 'var(--warning)' }} />
          <h2 className="card-title" style={{ margin: 0 }}>Dana Pending</h2>
          {ledgerPending.length > 0 && (
            <span className="badge badge-warning" style={{ marginLeft: 4 }}>{ledgerPending.length}</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Menunggu cair H+2 sejak invoice dibayar
          </span>
        </div>
        <LedgerTable entries={ledgerPending} showStatus={true} />
      </div>

      {/* Dana Tersedia Section */}
      <div className="card mobile-cards" style={{ marginTop: 16 }}>
        <div className="card-header" style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
          <h2 className="card-title" style={{ margin: 0 }}>Dana Tersedia</h2>
          {ledgerAvailable.length > 0 && (
            <span className="badge badge-success" style={{ marginLeft: 4 }}>{ledgerAvailable.length}</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Sudah dapat ditarik
          </span>
        </div>
        <LedgerTable entries={ledgerAvailable} showStatus={false} />
      </div>

      {/* Riwayat Penarikan & Transfer */}
      {ledgerDebit.length > 0 && (
        <div className="card mobile-cards" style={{ marginTop: 16 }}>
          <div className="card-header" style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowUpRight size={18} style={{ color: 'var(--danger)' }} />
            <h2 className="card-title" style={{ margin: 0 }}>Riwayat Penarikan & Transfer</h2>
            <span className="badge badge-danger" style={{ marginLeft: 4 }}>{ledgerDebit.length}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Penarikan dan transfer ke saldo disbursement
            </span>
          </div>
          <LedgerTable entries={ledgerDebit} showStatus={false} />
        </div>
      )}

      {/* Withdraw Modal */}
      {showWithdraw && (
        <div className="modal-overlay" onClick={closeWithdraw}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="modal-title">Tarik Dana</h3>

            {nonceLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
                <div style={{ fontSize: '0.9rem' }}>Mempersiapkan form penarikan...</div>
              </div>
            ) : (
              <>
                <div className="form-info-box">
                  Saldo tersedia: <strong>Rp {fmt(balance?.balance_available || 0)}</strong>
                </div>

                <form onSubmit={handleWithdraw}>
                  {/* Jumlah */}
                  <div className="form-group">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label className="form-label" style={{ margin: 0 }}>Jumlah (Rp) *</label>
                      <button
                        type="button"
                        onClick={() => {
                          const avail = balance?.balance_available || 0
                          const maxAmount = Math.max(0, avail - 2_500)  // avail - fee
                          setForm(prev => ({ ...prev, amount: maxAmount > 0 ? String(maxAmount) : '' }))
                          setFormError(null)
                        }}
                        style={{
                          fontSize: '0.72rem', fontWeight: 700,
                          padding: '3px 10px', borderRadius: 8,
                          background: 'rgba(16,185,129,0.12)',
                          color: 'var(--success)',
                          border: '1px solid rgba(16,185,129,0.25)',
                          cursor: 'pointer',
                          letterSpacing: '0.02em',
                        }}
                      >
                        Tarik Semua
                      </button>
                    </div>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="100.000"
                      inputMode="numeric"
                      value={form.amount ? fmt(form.amount) : ''}
                      onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '')
                        setForm(prev => ({ ...prev, amount: raw }))
                        setFormError(null)
                      }}
                      required
                    />
                    {form.amount && (() => {
                      const amt = parseFloat(form.amount) || 0
                      const fee = 2_500
                      if (amt < 50_000) {
                        return (
                          <div style={{ marginTop: 5, fontSize: '0.78rem', color: 'var(--danger)', fontWeight: 600 }}>
                            ✕ Minimal penarikan Rp 50.000
                          </div>
                        )
                      }
                      return (
                        <div style={{ marginTop: 6, fontSize: '0.78rem', lineHeight: 1.6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                            <span>Diterima</span>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Rp {fmt(amt)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                            <span>Biaya transfer</span>
                            <span style={{ color: '#f59e0b' }}>− Rp {fmt(fee)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, marginTop: 2, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Total dipotong</span>
                            <span style={{ color: (amt + fee) > (balance?.balance_available || 0) ? 'var(--danger)' : 'var(--success)' }}>
                              Rp {fmt(amt + fee)}
                            </span>
                          </div>
                        </div>
                      )
                    })()}
                  </div>


                  {/* Bank / E-Wallet Tujuan — searchable */}
                  <div className="form-group">
                    <label className="form-label">Bank / E-Wallet Tujuan *</label>
                    <BankSelect
                      banks={SUPPORTED_BANKS}
                      value={form.destination_bank}
                      onChange={bank => {
                        setForm(prev => ({ ...prev, destination_bank: bank }))
                        triggerCheck(form.destination_account, bank)
                        setFormError(null)
                      }}
                      required
                    />
                  </div>

                  {/* No. Rekening — auto-cek */}
                  <div className="form-group">
                    <label className="form-label">No. Rekening *</label>
                    <div style={{ position: 'relative' }}>
                      <input type="text" className="form-input"
                        placeholder="Nomor rekening tujuan"
                        value={form.destination_account}
                        style={{ paddingRight: 36 }}
                        onChange={e => {
                          const num = e.target.value.replace(/\D/g, '')
                          setForm(prev => ({ ...prev, destination_account: num, destination_name: '' }))
                          triggerCheck(num, form.destination_bank)
                          setFormError(null)
                        }}
                        required />
                      {acctChecking && (
                        <div className="spinner" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }} />
                      )}
                      {!acctChecking && acctChecked === 'error' && (
                        <XCircle size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--danger)' }} />
                      )}
                      {!acctChecking && acctChecked && acctChecked !== 'error' && (
                        <CheckCircle size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--success)' }} />
                      )}
                    </div>
                    {acctChecking && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Memverifikasi nomor rekening...</div>
                    )}
                    {acctChecked === 'error' && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: 4 }}>Nomor rekening tidak ditemukan atau tidak valid</div>
                    )}
                  </div>

                  {/* Nama Penerima — hanya muncul setelah verifikasi sukses */}
                  {acctChecked && acctChecked !== 'error' && (
                    <div className="form-group">
                      <label className="form-label">Nama Penerima</label>
                      <input type="text" className="form-input"
                        value={form.destination_name}
                        readOnly
                        style={{ background: 'rgba(34,197,94,0.06)', fontWeight: 600, cursor: 'default' }} />
                      <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle size={11} /> Terverifikasi
                      </div>
                    </div>
                  )}

                  {/* Password re-auth */}
                  <div className="form-group">
                    <label className="form-label">Password Akun *</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="form-input"
                        placeholder="Konfirmasi dengan password login Anda"
                        value={form.password}
                        style={{ paddingRight: 40 }}
                        onChange={e => { setForm(prev => ({ ...prev, password: e.target.value })); setFormError(null) }}
                        required
                        autoComplete="current-password"
                      />
                      <button type="button"
                        onClick={() => setShowPassword(p => !p)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Dibutuhkan untuk keamanan transaksi</div>
                  </div>

                  {formError && <div className="form-error-box">{formError}</div>}

                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={closeWithdraw} disabled={submitting}>Batal</button>
                    <button type="submit" className="btn btn-primary"
                      disabled={submitting || !nonce || acctChecking || acctChecked === 'error' || !acctChecked}>
                      {submitting ? 'Memproses...' : 'Konfirmasi Penarikan'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
