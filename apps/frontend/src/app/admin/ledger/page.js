'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { X, AlertTriangle, Plus, ArrowUpRight, Copy, Check, Loader2 } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))
const WITHDRAW_FEE = 2_500

const TYPE_CONFIG = {
  credit_pending:   { label: 'Credit Pending',   cls: 'badge-warning', prefix: '+' },
  credit_available: { label: 'Credit Available',  cls: 'badge-success', prefix: '+' },
  debit_withdraw:   { label: 'Debit Withdraw',    cls: 'badge-danger',  prefix: '−' },
}

const BANK_OPTIONS = [
  { code: 'mandiri', name: 'Bank Mandiri' },
  { code: 'bca', name: 'BCA' },
  { code: 'bni', name: 'BNI' },
  { code: 'bri', name: 'BRI' },
  { code: 'bsm', name: 'BSI' },
  { code: 'permata', name: 'Bank Permata' },
  { code: 'cimb', name: 'CIMB Niaga' },
  { code: 'danamon', name: 'Danamon' },
  { code: 'muamalat', name: 'Muamalat' },
  { code: 'btn', name: 'BTN' },
  { code: 'dbs', name: 'DBS' },
]

function Countdown({ targetDate }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const calc = () => {
      const now = new Date()
      const target = new Date(targetDate)
      const diff = target - now
      if (diff <= 0) { setTimeLeft('Siap settle'); return }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setTimeLeft(days > 0 ? `${days}h ${hours}j ${mins}m` : hours > 0 ? `${hours}j ${mins}m` : `${mins}m`)
    }
    calc()
    const interval = setInterval(calc, 60_000)
    return () => clearInterval(interval)
  }, [targetDate])

  const isReady = new Date(targetDate) <= new Date()
  return (
    <span style={{ fontSize: '0.75rem', fontWeight: 600, fontFamily: 'monospace', color: isReady ? '#10b981' : '#f59e0b', background: isReady ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.08)', padding: '2px 8px', borderRadius: 6 }}>
      {isReady ? '✓ ' : '⏳ '}{timeLeft}
    </span>
  )
}

function SettlementCell({ entry }) {
  if (entry.type === 'credit_pending' && !entry.settled_at) {
    return (
      <div>
        <Countdown targetDate={entry.available_at} />
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {new Date(entry.available_at).toLocaleString('id-ID')}
        </div>
      </div>
    )
  }
  if (entry.settled_at) {
    return <span style={{ color: '#10b981', fontSize: '0.82rem' }}>✓ {new Date(entry.settled_at).toLocaleDateString('id-ID')}</span>
  }
  return <span style={{ color: 'var(--text-muted)' }}>—</span>
}

// ── Searchable Bank Select ──────────────────────────────────
function BankSearchSelect({ value, onChange, options }) {
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
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch('') }}
        id="topup-bank"
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 10, textAlign: 'left',
          borderWidth: 1, borderStyle: 'solid', borderColor: open ? '#6366f1' : 'var(--border, rgba(255,255,255,0.1))',
          background: 'var(--bg-input, rgba(255,255,255,0.04))',
          color: 'var(--text-primary)', fontSize: '0.88rem', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          transition: 'border-color 0.2s',
        }}
      >
        <span>{selected?.name || value}</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          marginTop: 4, borderRadius: 10, overflow: 'hidden',
          background: 'var(--bg-card, #1a1a2e)',
          borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.1))',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border, rgba(255,255,255,0.08))' }}>
            <input
              autoFocus
              type="text"
              placeholder="Cari bank..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 6,
                borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.1))',
                background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)',
                fontSize: '0.82rem', outline: 'none',
              }}
            />
          </div>
          {/* Options */}
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 14px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tidak ditemukan</div>
            )}
            {filtered.map(b => (
              <button
                key={b.code}
                type="button"
                onClick={() => { onChange(b.code); setOpen(false); setSearch('') }}
                style={{
                  width: '100%', padding: '8px 14px', borderWidth: 0, textAlign: 'left',
                  background: b.code === value ? 'rgba(99,102,241,0.12)' : 'transparent',
                  color: b.code === value ? '#818cf8' : 'var(--text-primary)',
                  fontSize: '0.85rem', cursor: 'pointer', fontWeight: b.code === value ? 700 : 400,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (b.code !== value) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (b.code !== value) e.currentTarget.style.background = 'transparent' }}
              >
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

// ── Top-up Flip Modal ──────────────────────────────────────
function TopupFlipModal({ open, onClose, defaultAmount, onSuccess }) {
  const [step, setStep] = useState('form') // form → transferring → confirming → polling → done
  const [amount, setAmount] = useState(defaultAmount || 50000)
  const [senderBank, setSenderBank] = useState('mandiri')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [topupData, setTopupData] = useState(null)
  const [copied, setCopied] = useState('')
  const [pollInterval, setPollInterval] = useState(null)
  const [flipBalance, setFlipBalance] = useState(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setStep('form')
      setAmount(defaultAmount || 50000)
      setSenderBank('mandiri')
      setError('')
      setTopupData(null)
      setCopied('')
      setFlipBalance(null)
      // Fetch live balance
      setBalanceLoading(true)
      api.get('/v1/admin/topup-flip/alaflip-balance')
        .then(res => setFlipBalance(res.data))
        .catch(() => {})
        .finally(() => setBalanceLoading(false))
    }
    return () => { if (pollInterval) clearInterval(pollInterval) }
  }, [open])

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }

  // Step 1: Create topup
  const handleCreateTopup = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/v1/admin/topup-flip', { amount: Math.round(amount), sender_bank: senderBank })
      setTopupData(res.data)
      setStep('transferring')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Confirm topup (after manual bank transfer)
  const handleConfirm = async () => {
    if (!topupData?.topup_id) return
    setLoading(true)
    setError('')
    try {
      // Strip 'FT' prefix if present
      const rawId = topupData.topup_id.replace(/^FT/, '')
      await api.post(`/v1/admin/topup-flip/${rawId}/confirm`)
      setStep('polling')
      startPolling(rawId)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Step 3: Poll status
  const startPolling = (id) => {
    let count = 0
    const iv = setInterval(async () => {
      count++
      try {
        const res = await api.get(`/v1/admin/topup-flip/${id}/status`)
        const status = res.data?.status
        setTopupData(prev => ({ ...prev, ...res.data }))
        if (status === 'DONE' || status === 'PROCESSED') {
          clearInterval(iv)
          setPollInterval(null)
          setStep('done')
          onSuccess?.()
        }
      } catch {}
      if (count > 60) { clearInterval(iv); setPollInterval(null) } // max 5 min
    }, 5000)
    setPollInterval(iv)
  }

  if (!open) return null

  const totalTransfer = topupData ? (topupData.amount || 0) + (topupData.unique_code || 0) : 0
  const receiverBank = topupData?.receiver_bank

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={styles.iconCircle}><ArrowUpRight size={16} /></div>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Top Up Saldo Provider</span>
          </div>
          <button onClick={onClose} style={styles.closeBtn}><X size={16} /></button>
        </div>

        {/* Error */}
        {error && (
          <div style={styles.errorBox}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Step: Form */}
        {step === 'form' && (
          <div style={styles.body}>
            {/* Current Balance */}
            <div style={{
              padding: '12px 16px', borderRadius: 12, marginBottom: 16,
              background: 'rgba(99,102,241,0.08)',
              borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(99,102,241,0.2)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                  Saldo Provider Saat Ini
                </div>
                {balanceLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    <Loader2 size={12} className="spin" /> Memuat...
                  </div>
                ) : flipBalance ? (
                  <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#818cf8', fontFamily: 'monospace' }}>
                    Rp {fmt(flipBalance.balance || 0)}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>—</div>
                )}
              </div>
              {flipBalance?.account_name && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Akun</div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{flipBalance.account_name}</div>
                </div>
              )}
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Nominal Top Up</label>
              <div style={styles.amountInputWrap}>
                <span style={styles.amountPrefix}>Rp</span>
                <input
                  type="number"
                  min="10000"
                  step="1000"
                  value={amount}
                  onChange={e => setAmount(Number(e.target.value))}
                  style={styles.amountInput}
                  id="topup-amount"
                />
              </div>
              {/* Quick amount buttons */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[50000, 100000, 200000, 300000, 500000].map(v => (
                  <button key={v} onClick={() => setAmount(v)} style={{ ...styles.quickBtn, ...(amount === v ? styles.quickBtnActive : {}) }}>
                    {fmt(v)}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Bank Pengirim</label>
              <BankSearchSelect
                value={senderBank}
                onChange={setSenderBank}
                options={BANK_OPTIONS}
              />
            </div>

            <button
              onClick={handleCreateTopup}
              disabled={loading || amount < 10000}
              style={{ ...styles.primaryBtn, ...(loading ? { opacity: 0.7 } : {}) }}
              id="topup-submit"
            >
              {loading ? <><Loader2 size={14} className="spin" /> Memproses...</> : 'Buat Top Up'}
            </button>
          </div>
        )}

        {/* Step: Transferring — show bank details */}
        {step === 'transferring' && topupData && (
          <div style={styles.body}>
            <div style={styles.successBanner}>
              ✅ Top up berhasil dibuat! Transfer sesuai detail berikut:
            </div>

            <div style={styles.detailCard}>
              <DetailRow label="Bank Tujuan" value={receiverBank?.bank?.toUpperCase() || '-'} />
              <DetailRow
                label="No. Rekening"
                value={receiverBank?.account_number || '-'}
                copiable
                onCopy={() => copyText(receiverBank?.account_number, 'rekening')}
                isCopied={copied === 'rekening'}
              />
              <DetailRow label="Atas Nama" value={receiverBank?.name || '-'} />
              <div style={styles.divider} />
              <DetailRow label="Nominal" value={`Rp ${fmt(topupData.amount || 0)}`} />
              <DetailRow label="Kode Unik" value={`+${topupData.unique_code || 0}`} accent />
              <div style={styles.divider} />
              <DetailRow
                label="Total Transfer"
                value={`Rp ${fmt(totalTransfer)}`}
                bold
                copiable
                onCopy={() => copyText(String(totalTransfer), 'total')}
                isCopied={copied === 'total'}
              />
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              ⚠️ Pastikan transfer <strong>tepat Rp {fmt(totalTransfer)}</strong> (termasuk kode unik).
              Setelah transfer selesai, klik tombol konfirmasi.
            </div>

            <button onClick={handleConfirm} disabled={loading} style={styles.primaryBtn} id="topup-confirm">
              {loading ? <><Loader2 size={14} className="spin" /> Mengonfirmasi...</> : '✓ Sudah Transfer — Konfirmasi'}
            </button>
          </div>
        )}

        {/* Step: Polling */}
        {step === 'polling' && (
          <div style={styles.body}>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Loader2 size={32} className="spin" style={{ color: '#6366f1', marginBottom: 12 }} />
              <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>Menunggu Konfirmasi Flip...</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Status: <span style={{ color: '#f59e0b', fontWeight: 700 }}>{topupData?.status || 'PENDING'}</span>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8 }}>Polling otomatis setiap 5 detik...</div>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div style={styles.body}>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#10b981', marginBottom: 4 }}>Top Up Berhasil!</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                Saldo Provider telah bertambah Rp {fmt(topupData?.amount || 0)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Status: <span style={{ color: '#10b981', fontWeight: 700 }}>{topupData?.status}</span>
              </div>
            </div>
            <button onClick={onClose} style={styles.primaryBtn}>Tutup</button>
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
        <span style={{
          fontWeight: bold ? 800 : accent ? 700 : 600,
          fontSize: bold ? '1.05rem' : '0.85rem',
          color: accent ? '#f59e0b' : bold ? '#10b981' : 'var(--text-primary)',
          fontFamily: 'monospace',
        }}>{value}</span>
        {copiable && (
          <button onClick={onCopy} style={styles.copyBtn} title="Salin">
            {isCopied ? <Check size={12} style={{ color: '#10b981' }} /> : <Copy size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}

function ManualWithdrawalModal({ open, onClose, merchant, onSuccess }) {
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [acctChecking, setAcctChecking] = useState(false)
  const [acctChecked, setAcctChecked] = useState(null) // null | { account_name } | 'error'
  const checkTimerRef = useRef(null)
  const [form, setForm] = useState({
    amount_received: '',
    destination_bank: 'bca',
    destination_account: '',
    destination_name: '',
    reason_code: 'KYC_OPTOUT',
  })

  useEffect(() => {
    if (!open || !merchant) return
    const maxAmount = Math.max(0, Number(merchant.balance_available || 0) - WITHDRAW_FEE)
    setForm({
      amount_received: maxAmount > 0 ? String(Math.floor(maxAmount)) : '',
      destination_bank: 'bca',
      destination_account: '',
      destination_name: '',
      reason_code: 'KYC_OPTOUT',
    })
    setAcctChecking(false)
    setAcctChecked(null)
  }, [open, merchant])

  useEffect(() => {
    if (!open || !merchant) return
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current)

    const account = form.destination_account?.trim()
    const bank = form.destination_bank

    if (!bank || !account || account.length < 5) {
      setAcctChecked(null)
      setForm(prev => ({ ...prev, destination_name: '' }))
      return
    }

    checkTimerRef.current = setTimeout(async () => {
      setAcctChecking(true)
      setAcctChecked(null)
      try {
        const res = await api.post('/v1/lookup/check-account', {
          account_number: account,
          bank,
        })
        const name = res.data?.account_name?.trim() || ''
        if (!name) throw new Error('Nama rekening tidak ditemukan')
        setForm(prev => ({ ...prev, destination_name: name }))
        setAcctChecked({ account_name: name })
      } catch {
        setForm(prev => ({ ...prev, destination_name: '' }))
        setAcctChecked('error')
      } finally {
        setAcctChecking(false)
      }
    }, 650)

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    }
  }, [open, merchant, form.destination_account, form.destination_bank])

  if (!open || !merchant) return null

  const amount = Number(form.amount_received || 0)
  const totalDebit = amount + WITHDRAW_FEE
  const available = Number(merchant.balance_available || 0)
  const insufficient = totalDebit > available
  const amountBelowMinimum = amount > 0 && amount < 50_000
  const accountIncomplete = !form.destination_bank || !form.destination_account || form.destination_account.length < 5
  const accountUnverified = acctChecking || acctChecked === 'error' || !form.destination_name || form.destination_name.length < 2

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    if (!amount || amount < 50_000) return toast.error('Minimal amount diterima merchant Rp 50.000')
    if (!form.destination_account || form.destination_account.length < 5) return toast.error('Nomor rekening tidak valid')
    if (acctChecking) return toast.error('Sedang cek rekening, mohon tunggu sebentar')
    if (acctChecked === 'error' || !form.destination_name || form.destination_name.length < 2) {
      return toast.error('Nama rekening belum valid. Cek kembali bank dan nomor rekening.')
    }
    if (insufficient) return toast.error('Saldo available tidak cukup untuk nominal + fee')

    setSubmitting(true)
    try {
      const payload = {
        amount_received: amount,
        destination_bank: form.destination_bank,
        destination_account: form.destination_account.trim(),
        destination_name: form.destination_name.trim(),
      }

      if (form.reason_code === 'KYC_OPTOUT') {
        const res = await api.post(`/v1/admin/clients/${merchant.client_id}/kyc-optout/finalize`, payload)
        toast.success(res.message || 'KYC opt-out diproses')
      } else {
        await api.post('/v1/admin/withdrawals', {
          client_id: merchant.client_id,
          ...payload,
          ...(form.reason_code ? { reason_code: form.reason_code } : {}),
        })
        toast.success('Withdrawal berhasil dibuat dan otomatis diproses')
      }
      onSuccess?.()
      onClose?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Buat Withdrawal Admin</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{merchant.client_name}</div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 8 }}>{merchant.client_email}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
            <span>Saldo available</span>
            <strong style={{ color: '#10b981' }}>Rp {fmt(available)}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Bank Tujuan</label>
            <BankSearchSelect value={form.destination_bank} onChange={(v) => setForm(prev => ({ ...prev, destination_bank: v }))} options={BANK_OPTIONS} />
          </div>

          <div className="form-group">
            <label className="form-label">Nomor Rekening</label>
            <input
              className="form-input"
              value={form.destination_account}
              onChange={e => setForm(prev => ({ ...prev, destination_account: e.target.value.replace(/\D/g, '') }))}
              placeholder="Contoh: 1234567890"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Nama Pemilik Rekening</label>
            <input
              className="form-input"
              value={form.destination_name}
              readOnly
              placeholder="Otomatis dari cek rekening"
              required
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {acctChecking && (
                <span className="badge badge-warning">Mengecek rekening...</span>
              )}
              {!acctChecking && acctChecked && acctChecked !== 'error' && (
                <>
                  <span className="badge badge-success">Terverifikasi</span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{acctChecked.account_name}</span>
                </>
              )}
              {!acctChecking && acctChecked === 'error' && (
                <span className="badge badge-danger">Rekening tidak valid / nama rekening tidak ditemukan</span>
              )}
              {!acctChecking && !acctChecked && (
                <span className="badge badge-info">Isi bank dan nomor rekening untuk verifikasi otomatis</span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Nominal Diterima Merchant</label>
            <input
              type="text"
              inputMode="numeric"
              className="form-input"
              value={form.amount_received}
              onChange={e => setForm(prev => ({ ...prev, amount_received: e.target.value.replace(/\D/g, '') }))}
              required
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {amountBelowMinimum ? (
                <span className="badge badge-danger">Minimal withdrawal Rp 50.000</span>
              ) : (
                <span className="badge badge-info">Minimal withdrawal Rp 50.000</span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Reason Code Audit</label>
            <select
              className="form-input"
              value={form.reason_code}
              onChange={e => setForm(prev => ({ ...prev, reason_code: e.target.value }))}
            >
              <option value="KYC_OPTOUT">KYC_OPTOUT</option>
              <option value="">(Kosong)</option>
            </select>
          </div>

          <div style={{ padding: '10px 12px', borderRadius: 10, background: insufficient ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', border: insufficient ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(16,185,129,0.2)', marginBottom: 16, fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Amount received</span><strong>Rp {fmt(amount)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Fee withdrawal</span><strong>Rp {fmt(WITHDRAW_FEE)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Total didebit saldo</span><span>Rp {fmt(totalDebit)}</span>
            </div>
            {insufficient && (
              <div style={{ marginTop: 6, color: '#ef4444', fontWeight: 700 }}>
                Saldo tidak cukup untuk nominal ini.
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Batal</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || insufficient || amountBelowMinimum || accountIncomplete || accountUnverified}
            >
              {submitting ? 'Memproses...' : 'Buat & Proses Otomatis'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal styles ─────────────────────────────────────────────
const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: 'var(--bg-card, #1a1a2e)', borderRadius: 16,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.08))',
    width: '100%', maxWidth: 440,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    overflow: 'visible',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px',
    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border, rgba(255,255,255,0.08))',
  },
  iconCircle: {
    width: 32, height: 32, borderRadius: '50%',
    background: 'rgba(99,102,241,0.15)', color: '#6366f1',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
    padding: 4, borderRadius: 6,
  },
  body: { padding: '16px 20px 20px' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' },
  amountInputWrap: {
    display: 'flex', alignItems: 'center', gap: 0,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.1))',
    borderRadius: 10, overflow: 'hidden',
    background: 'var(--bg-input, rgba(255,255,255,0.04))',
  },
  amountPrefix: {
    padding: '10px 12px', fontSize: '0.88rem', fontWeight: 700,
    color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)',
    borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: 'var(--border, rgba(255,255,255,0.08))',
  },
  amountInput: {
    flex: 1, padding: '10px 12px', borderWidth: 0, outline: 'none',
    background: 'transparent', color: 'var(--text-primary)',
    fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace',
  },
  quickBtn: {
    padding: '4px 10px', borderRadius: 8,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.1))',
    background: 'transparent', color: 'var(--text-muted)', fontSize: '0.72rem',
    cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
  },
  quickBtnActive: {
    background: 'rgba(99,102,241,0.15)', borderColor: '#6366f1', color: '#6366f1',
  },
  select: {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.1))',
    background: 'var(--bg-input, rgba(255,255,255,0.04))',
    color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none',
  },
  primaryBtn: {
    width: '100%', padding: '12px', borderRadius: 10,
    borderWidth: 0, borderStyle: 'none', borderColor: 'transparent',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
    fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    transition: 'all 0.2s',
  },
  errorBox: {
    margin: '0 20px', padding: '10px 14px', borderRadius: 10,
    background: 'rgba(239,68,68,0.1)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(239,68,68,0.2)',
    color: '#ef4444', fontSize: '0.78rem', fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  successBanner: {
    padding: '10px 14px', borderRadius: 10, marginBottom: 16,
    background: 'rgba(16,185,129,0.1)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(16,185,129,0.2)',
    color: '#10b981', fontSize: '0.78rem', fontWeight: 600,
  },
  detailCard: {
    padding: '12px 16px', borderRadius: 12, marginBottom: 16,
    background: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.08))',
  },
  divider: {
    height: 1, background: 'var(--border, rgba(255,255,255,0.08))', margin: '4px 0',
  },
  copyBtn: {
    background: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, rgba(255,255,255,0.1))',
    borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--text-muted)',
    display: 'flex', alignItems: 'center',
  },
}

// ── Main Page ────────────────────────────────────────────────
export default function AdminLedgerPage() {
  const toast = useToast()
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterType, setFilterType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [merchantBalances, setMerchantBalances] = useState(null)
  const [mbLoading, setMbLoading] = useState(true)
  const [showTopup, setShowTopup] = useState(false)
  const [showWithdrawal, setShowWithdrawal] = useState(false)
  const [selectedMerchant, setSelectedMerchant] = useState(null)
  const PER_PAGE = 20

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try { const res = await api.get('/v1/admin/ledger-stats'); setStats(res.data) } catch { }
    finally { setStatsLoading(false) }
  }, [])

  const loadMerchantBalances = useCallback(async () => {
    setMbLoading(true)
    try { const res = await api.get('/v1/admin/merchant-balances?min_balance=52500'); setMerchantBalances(res.data) } catch { }
    finally { setMbLoading(false) }
  }, [])

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterType) params.set('type', filterType)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await api.get(`/v1/admin/ledger?${params}`)
      setEntries(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadStats(); loadMerchantBalances() }, [])
  useEffect(() => { load(1); setPage(1) }, [filterType, dateFrom, dateTo])
  useEffect(() => { load(page) }, [page])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Balance Ledger</h1>
          <p className="page-subtitle">{total} entri mutasi saldo</p>
        </div>
      </div>

      {/* Stats */}
      {!statsLoading && stats && (
        <div className="admin-stats-grid">
          {[
            { label: 'Saldo Pending', val: stats.total_pending, color: '#f59e0b', prefix: 'Rp ' },
            { label: 'Saldo Available', val: stats.total_available, color: '#10b981', prefix: 'Rp ' },
            { label: 'Total Earned', val: stats.total_earned, color: '#6366f1', prefix: 'Rp ' },
            { label: 'Total Withdrawn', val: stats.total_withdrawn, color: '#ef4444', prefix: 'Rp ' },
            { label: 'Menunggu Settlement', val: stats.pending_settlements, color: '#f59e0b', sub: `Rp ${fmt(stats.pending_settlements_amount)}` },
          ].map(({ label, val, color, prefix, sub }) => (
            <div key={label} className="admin-stat-card" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
              <div className="admin-stat-value" style={{ color }}>{prefix || ''}{fmt(val)}</div>
              <div className="admin-stat-label">{label}</div>
              {sub && <div className="admin-stat-sub" style={{ color }}>{sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Merchant Balances */}
      {!mbLoading && merchantBalances && merchantBalances.merchants.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="admin-alert-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.78rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <AlertTriangle size={14} />
              Merchant Siap Tarik — Rp {fmt(merchantBalances.total_needed)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(saldo ≥ Rp 52.500)</span>
              <button
                onClick={() => setShowTopup(true)}
                id="topup-flip-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 8,
                  borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(99,102,241,0.3)',
                  background: 'rgba(99,102,241,0.12)',
                  color: '#818cf8', fontSize: '0.72rem', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.2s',
                  textTransform: 'uppercase', letterSpacing: '0.03em',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.25)'; e.currentTarget.style.borderColor = '#6366f1' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)' }}
              >
                <Plus size={12} /> Add Funds
              </button>
            </div>
          </div>
          <AdminTable
            columns={[
              { key: 'merchant', label: 'Merchant' },
              { key: 'available', label: 'Available' },
              { key: 'pending', label: 'Pending' },
              { key: 'earned', label: 'Earned', hide: true },
              { key: 'withdrawn', label: 'Withdrawn', hide: true },
              { key: 'action', label: 'Aksi', width: 1 },
            ]}
            data={merchantBalances.merchants}
            cardTitle={(m) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{m.client_name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.client_email}</div>
                </div>
                <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1rem' }}>Rp {fmt(m.balance_available)}</span>
              </div>
            )}
            renderRow={(m) => {
              const canWithdraw = Number(m.balance_available || 0) >= (50_000 + WITHDRAW_FEE)
              return {
                cells: {
                  merchant: (
                    <>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{m.client_name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.client_email}</div>
                    </>
                  ),
                  available: <span style={{ fontWeight: 800, color: '#10b981' }}>Rp {fmt(m.balance_available)}</span>,
                  pending: <span style={{ color: '#f59e0b', fontWeight: 600 }}>Rp {fmt(m.balance_pending)}</span>,
                  earned: <span className="text-sm text-muted">Rp {fmt(m.total_earned)}</span>,
                  withdrawn: <span className="text-sm text-muted">Rp {fmt(m.total_withdrawn)}</span>,
                  action: (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={!canWithdraw}
                      onClick={() => {
                        if (!canWithdraw) return toast.error('Saldo belum cukup untuk withdrawal minimal')
                        setSelectedMerchant(m)
                        setShowWithdrawal(true)
                      }}
                    >
                      Tarik
                    </button>
                  ),
                },
                actions: (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!canWithdraw}
                    onClick={() => {
                      if (!canWithdraw) return toast.error('Saldo belum cukup untuk withdrawal minimal')
                      setSelectedMerchant(m)
                      setShowWithdrawal(true)
                    }}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Tarik
                  </button>
                )
              }
            }}
          />
        </div>
      )}

      {/* Top-up Modal */}
      <TopupFlipModal
        open={showTopup}
        onClose={() => setShowTopup(false)}
        defaultAmount={merchantBalances?.total_needed || 50000}
        onSuccess={() => { loadStats(); loadMerchantBalances() }}
      />
      <ManualWithdrawalModal
        open={showWithdrawal}
        merchant={selectedMerchant}
        onClose={() => { setShowWithdrawal(false); setSelectedMerchant(null) }}
        onSuccess={() => {
          loadStats()
          loadMerchantBalances()
          load(1)
          setPage(1)
        }}
      />

      {/* Filters */}
      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['credit_pending', 'Credit Pending'], ['credit_available', 'Credit Available'], ['debit_withdraw', 'Debit Withdraw']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterType(val)} className={`btn btn-sm ${filterType === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        {(filterType || dateFrom || dateTo) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterType(''); setDateFrom(''); setDateTo('') }}><X size={12} /> Reset</button>
        )}
      </div>

      {/* Ledger Table */}
      <div className="admin-section-label">Riwayat Mutasi</div>
      <AdminTable
        columns={[
          { key: 'merchant', label: 'Merchant' },
          { key: 'type', label: 'Tipe' },
          { key: 'amount', label: 'Nominal' },
          { key: 'ref', label: 'Referensi' },
          { key: 'note', label: 'Catatan', hide: true },
          { key: 'settlement', label: 'Settlement' },
          { key: 'created', label: 'Dibuat', hide: true },
        ]}
        data={entries}
        loading={loading}
        emptyText="Tidak ada entri"
        cardTitle={(entry) => {
          const tc = TYPE_CONFIG[entry.type] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{entry.client_name}</div>
                <span className={`badge ${tc.cls}`} style={{ marginTop: 4 }}>{tc.label}</span>
              </div>
              <span style={{ fontWeight: 800, color: entry.type === 'debit_withdraw' ? '#ef4444' : '#10b981', fontSize: '1rem' }}>
                {tc.prefix}Rp {fmt(entry.amount)}
              </span>
            </div>
          )
        }}
        cardAccent={(entry) => entry.type === 'debit_withdraw' ? '#ef4444' : entry.type === 'credit_pending' ? '#f59e0b' : '#10b981'}
        renderRow={(entry) => {
          const tc = TYPE_CONFIG[entry.type] || {}
          return {
            cells: {
              merchant: (
                <>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{entry.client_name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{entry.client_email}</div>
                </>
              ),
              type: <span className={`badge ${tc.cls}`}>{tc.label}</span>,
              amount: <span style={{ fontWeight: 700, color: entry.type === 'debit_withdraw' ? '#ef4444' : '#10b981' }}>{tc.prefix}Rp {fmt(entry.amount)}</span>,
              ref: entry.invoice_number ? <span className="font-mono" style={{ fontSize: '0.78rem' }}>{entry.invoice_number}</span> : entry.withdrawal_info ? <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>WD: {entry.withdrawal_info}</span> : '—',
              note: entry.note || '—',
              settlement: <SettlementCell entry={entry} />,
              created: <span className="text-sm text-muted">{new Date(entry.created_at).toLocaleString('id-ID')}</span>,
            }
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}
