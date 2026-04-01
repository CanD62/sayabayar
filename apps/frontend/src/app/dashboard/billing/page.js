'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Star, ArrowUpRight, RotateCcw, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { SkeletonCard } from '@/components/Skeleton'

import { fmt } from '@/lib/format'

function daysLeft(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export default function BillingPage() {
  const router = useRouter()
  const toast = useToast()
  const [plans, setPlans] = useState([])
  const [current, setCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [confirmPlan, setConfirmPlan] = useState(null)
  const [isRenew, setIsRenew] = useState(false)

  const load = () => {
    Promise.all([
      api.get('/v1/subscriptions/plans'),
      api.get('/v1/subscriptions/current')
    ])
      .then(([p, c]) => { setPlans(p.data); setCurrent(c.data) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleUpgrade = async () => {
    if (!confirmPlan) return
    setActivating(true)
    try {
      const res = await api.post('/v1/subscriptions/upgrade', { plan_id: confirmPlan.id })
      if (res.data.status === 'pending_payment') {
        router.push(res.data.payment_url)
      } else {
        toast.success(isRenew ? 'Langganan berhasil diperpanjang!' : 'Plan berhasil diaktifkan!')
        load()
      }
    } catch (err) {
      toast.error(err.message || 'Gagal memproses')
    } finally {
      setActivating(false)
      setConfirmPlan(null)
      setIsRenew(false)
    }
  }

  const openRenew = () => {
    setIsRenew(true)
    setConfirmPlan(current.plan)
  }

  if (loading) return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SkeletonCard />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SkeletonCard /><SkeletonCard />
      </div>
    </div>
  )

  const remaining = current?.plan?.plan_type === 'subscription'
    ? daysLeft(current?.current_period_end)
    : null
  const isWarning = remaining !== null && remaining <= 7

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Kelola langganan dan plan Anda</p>
        </div>
      </div>

      {/* Current Plan */}
      {current?.plan && (
        <div className="card" style={{ marginBottom: 24, borderColor: isWarning ? 'var(--warning, #f59e0b)' : undefined }}>
          <div className="card-header">
            <h2 className="card-title">Plan Aktif</h2>
          </div>
          <div style={{ padding: '0 0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className={`confirm-icon ${current.plan.plan_type === 'free' ? 'confirm-icon-primary' : 'confirm-icon-warning'}`} style={{ margin: 0, width: 44, height: 44, flexShrink: 0 }}>
                <Star size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{current.plan.name}</div>
                <div className="text-sm text-muted">
                  {current.plan.plan_type === 'free'
                    ? 'Menggunakan channel platform'
                    : `Rp ${fmt(current.plan.monthly_price)}/bulan`}
                </div>
              </div>
              <span className="badge badge-success">Aktif</span>
            </div>

            {/* Expiry info */}
            {current.plan.plan_type === 'subscription' && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div className="text-sm text-muted">
                    Berlaku sampai: <strong>{new Date(current.current_period_end).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                  </div>
                  {remaining !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      {isWarning && <AlertTriangle size={14} style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />}
                      <span style={{ fontSize: '0.82rem', color: isWarning ? 'var(--warning, #f59e0b)' : 'var(--text-muted)', fontWeight: isWarning ? 600 : 400 }}>
                        {remaining <= 0 ? 'Langganan sudah habis' : `Sisa ${remaining} hari`}
                        {isWarning && remaining > 0 && ' — segera perpanjang'}
                      </span>
                    </div>
                  )}
                </div>
                <button className="btn btn-primary btn-sm" onClick={openRenew} style={{ flexShrink: 0 }}>
                  <RotateCcw size={14} /> Perpanjang
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plans */}
      <div className="card">
        <div className="card-header"><h2 className="card-title">Pilih Plan</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {plans.map(plan => {
            const isActive = current?.plan?.id === plan.id
            return (
              <div key={plan.id} className="plan-card" style={{ border: isActive ? '2px solid var(--accent)' : undefined }}>
                {isActive && <span className="badge badge-success" style={{ position: 'absolute', top: 12, right: 12 }}>Aktif</span>}
                <div className={`confirm-icon ${plan.plan_type === 'free' ? 'confirm-icon-primary' : 'confirm-icon-warning'}`} style={{ margin: '0 0 12px', width: 44, height: 44 }}>
                  <Star size={20} />
                </div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>{plan.name}</h3>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
                  {plan.monthly_price === 0 ? 'Gratis' : `Rp ${fmt(plan.monthly_price)}`}
                  {plan.monthly_price > 0 && <span className="text-sm text-muted" style={{ fontWeight: 400 }}>/bulan</span>}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', fontSize: '0.85rem' }}>
                  <li style={{ padding: '4px 0' }}>{plan.can_add_own_channel ? '✓ Channel sendiri (1 BCA + 1 QRIS)' : '✗ Tidak bisa tambah channel'}</li>
                  <li style={{ padding: '4px 0' }}>{plan.can_add_own_channel ? '✓ Dana langsung ke rekening Anda' : '✗ Dana via platform → withdraw'}</li>
                  <li style={{ padding: '4px 0' }}>Fee withdraw: Rp {fmt(plan.withdraw_fee)}</li>
                  <li style={{ padding: '4px 0' }}>{plan.can_add_own_channel ? '✓ Channel platform sebagai backup' : '✓ Menggunakan channel platform'}</li>
                </ul>
                {isActive && plan.plan_type === 'subscription' && (
                  <button className="btn btn-primary" onClick={openRenew} style={{ width: '100%' }}>
                    <RotateCcw size={16} /> Perpanjang +1 Bulan
                  </button>
                )}
                {!isActive && plan.plan_type !== 'free' && (
                  <button className="btn btn-primary" onClick={() => { setIsRenew(false); setConfirmPlan(plan) }} style={{ width: '100%' }}>
                    <ArrowUpRight size={16} /> Upgrade Sekarang
                  </button>
                )}
                {!isActive && plan.plan_type === 'free' && (
                  <p className="text-sm text-muted" style={{ textAlign: 'center', fontStyle: 'italic' }}>
                    Otomatis aktif jika langganan berakhir
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Upgrade / Renew Modal */}
      {confirmPlan && (
        <div className="modal-overlay" onClick={() => { setConfirmPlan(null); setIsRenew(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div className="confirm-icon confirm-icon-warning"><Star size={28} /></div>
              <h3 className="modal-title" style={{ marginBottom: 8 }}>
                {isRenew ? `Perpanjang ${confirmPlan.name}` : `Upgrade ke ${confirmPlan.name}`}
              </h3>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                Rp {fmt(confirmPlan.monthly_price)}<span className="text-sm text-muted" style={{ fontWeight: 400 }}>/bulan</span>
              </div>
              <p className="text-sm text-muted">
                {isRenew
                  ? 'Anda akan diarahkan ke halaman pembayaran. Setelah pembayaran berhasil, langganan diperpanjang 1 bulan dari sekarang.'
                  : 'Anda akan diarahkan ke halaman pembayaran. Setelah pembayaran berhasil, langganan langsung aktif.'}
              </p>
              {isRenew && remaining !== null && remaining > 0 && (
                <div style={{ marginTop: 12, background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)', borderRadius: 8, padding: '8px 12px', fontSize: '0.82rem' }}>
                  ℹ️ Sisa langganan aktif: <strong>{remaining} hari</strong>. Perpanjang sekarang jika ingin menambah 1 bulan lagi.
                </div>
              )}
              <div className="form-info-box" style={{ textAlign: 'left', marginTop: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Yang Anda dapatkan:</div>
                <div>✓ Channel BCA & QRIS sendiri</div>
                <div>✓ Dana langsung ke rekening Anda</div>
                <div>✓ Channel platform sebagai backup</div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setConfirmPlan(null); setIsRenew(false) }} disabled={activating}>Batal</button>
              <button className="btn btn-primary" onClick={handleUpgrade} disabled={activating}>
                {activating ? 'Memproses...' : `${isRenew ? 'Perpanjang' : 'Bayar'} Rp ${fmt(confirmPlan.monthly_price)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
