'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pause, Play, Lock, Trash2, RotateCcw, AlertTriangle, Star, Building2, Upload, CheckCircle, XCircle, Pencil, Wifi } from 'lucide-react'
import { api } from '@/lib/api'
import { decodeQrFromFile, parseQrisString } from '@/lib/qris'
import { useToast } from '@/components/Toast'
import ConfirmModal from '@/components/ConfirmModal'
import { SkeletonTable } from '@/components/Skeleton'

export default function ChannelsPage() {
  const router = useRouter()
  const toast = useToast()
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionLoading, setActionLoading] = useState({})
  const [form, setForm] = useState({ channel_type: 'bca_transfer', account_name: '', account_number: '', scraping_config: { username: '', password: '' }, qris_data: '' })
  const [formError, setFormError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [cleanTarget, setCleanTarget] = useState(null)
  const [restartingIds, setRestartingIds] = useState(new Map()) // Map<channelId, restartTimestamp>
  const [plan, setPlan] = useState(null)
  // Edit modal state
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({ scraping_config: { username: '', password: '' }, qris_data: '' })
  const [editError, setEditError] = useState(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editQrisInfo, setEditQrisInfo] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const editFileRef = useRef(null)
  // QRIS-specific state
  const [qrisInfo, setQrisInfo] = useState(null)
  const [qrisDragging, setQrisDragging] = useState(false)
  const [qrisDecoding, setQrisDecoding] = useState(false)
  const fileInputRef = useRef(null)

  // BCA Transfer: auto-cek rekening saat no rek diisi
  const [acctChecking, setAcctChecking] = useState(false)
  const [acctChecked, setAcctChecked] = useState(null) // null | { account_name } | 'error'
  const checkTimerRef = useRef(null)

  const checkBcaAccount = useCallback(async (accountNumber) => {
    if (!accountNumber || accountNumber.length < 8) return
    setAcctChecking(true)
    setAcctChecked(null)
    try {
      const res = await api.post('/v1/lookup/check-account', {
        account_number: accountNumber,
        bank: 'bca'  // Flip menggunakan kode bank lowercase
      })
      const name = res.data?.account_name
      setAcctChecked({ account_name: name })
      setForm(prev => ({ ...prev, account_name: name || '' }))
    } catch {
      setAcctChecked('error')
      setForm(prev => ({ ...prev, account_name: '' }))
    } finally {
      setAcctChecking(false)
    }
  }, [])

  const isQris = form.channel_type.startsWith('qris_')
  const isQrisBca = form.channel_type === 'qris_bca'
  const isQrisGopay = form.channel_type === 'qris_gopay'
  const isQrisEmail = isQrisBca || isQrisGopay  // channel yang pakai email sebagai username

  const load = () => {
    Promise.all([
      api.get('/v1/channels'),
      api.get('/v1/subscriptions/current')
    ]).then(([ch, sub]) => {
      setChannels(ch.data)
      setPlan(sub.data?.plan)
      // Auto-clear restartingIds ketika:
      // (1) last_success_at lebih baru dari restart timestamp (sukses), atau
      // (2) last_scraped_at lebih baru dari restart timestamp (scraper sudah jalan, meski gagal)
      setRestartingIds(prev => {
        const next = new Map(prev)
        for (const [id, ts] of next) {
          const channel = ch.data.find(c => c.id === id)
          if (!channel) { next.delete(id); continue }
          const successNewer = channel.last_success_at && new Date(channel.last_success_at).getTime() > ts
          const scrapedAfterRestart = channel.last_scraped_at && new Date(channel.last_scraped_at).getTime() > ts
          if (successNewer || scrapedAfterRestart) next.delete(id)
        }
        return next
      })
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5_000)
    return () => clearInterval(interval)
  }, [])

  const isFree = plan?.plan_type === 'free'
  const maxChannels = plan?.max_channels ?? 0
  const ownChannelCount = channels.filter(c => c.channel_owner === 'client').length
  const isAtLimit = !isFree && maxChannels > 0 && ownChannelCount >= maxChannels

  const closeModal = () => {
    setShowModal(false)
    setFormError(null)
    setQrisInfo(null)
    setAcctChecked(null)
    clearTimeout(checkTimerRef.current)
    setForm({ channel_type: 'bca_transfer', account_name: '', account_number: '', scraping_config: { username: '', password: '' }, qris_data: '' })
  }

  // ── QR Code decode handler ───────────────────────────
  const handleQrFile = async (file) => {
    if (!file) return
    setQrisDecoding(true)
    setFormError(null)
    setQrisInfo(null)

    try {
      const qrisString = await decodeQrFromFile(file)
      const info = parseQrisString(qrisString)

      if (!info.valid) {
        setFormError('QR code bukan QRIS yang valid. Pastikan QR code benar.')
        return
      }

      setQrisInfo(info)
      setForm(prev => ({ ...prev, qris_data: qrisString }))
    } catch (err) {
      setFormError(err.message)
    } finally {
      setQrisDecoding(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setQrisDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleQrFile(file)
    } else {
      setFormError('Hanya file gambar yang didukung (PNG, JPG)')
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setFormError(null)

    // Validate credentials
    if (!form.scraping_config.username.trim()) { setFormError('Username wajib diisi'); return }
    if (isQrisEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(form.scraping_config.username.trim())) {
        setFormError(`Username ${isQrisGopay ? 'QRIS GoPay' : 'QRIS BCA'} harus berupa alamat email yang valid`); return
      }
    }
    if (!form.scraping_config.password.trim()) { setFormError('Password wajib diisi'); return }

    if (isQris) {
      if (!form.qris_data) { setFormError('Upload QR code QRIS terlebih dahulu'); return }
    } else {
      if (!form.account_name.trim()) { setFormError('Nama akun wajib diisi'); return }
      if (!form.account_number.trim()) { setFormError('Nomor rekening wajib diisi'); return }
    }

    setSubmitting(true)
    try {
      const body = {
        channel_type: form.channel_type,
        scraping_config: form.scraping_config,
      }
      if (isQris) {
        body.qris_data = form.qris_data
      } else {
        body.account_name = form.account_name
        body.account_number = form.account_number
      }

      await api.post('/v1/channels', body)
      closeModal()
      toast.success('Channel berhasil ditambahkan')
      load()
    } catch (err) {
      if (err.code === 'PLAN_NOT_ALLOWED' || err.code === 'PLAN_FEATURE_UNAVAILABLE') {
        closeModal()
        toast.warning('Fitur ini hanya tersedia untuk plan Langganan')
      } else if (err.code === 'MAX_CHANNELS_REACHED') {
        closeModal()
        toast.warning(err.message || 'Batas maksimal channel telah tercapai')
      } else {
        setFormError(err.message || 'Gagal menambahkan channel')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (id, isActive) => {
    try {
      await api.patch(`/v1/channels/${id}`, { is_active: !isActive })
      // Optimistic update: langsung ubah is_active di local state
      setChannels(prev => prev.map(c => c.id === id ? { ...c, is_active: !isActive } : c))
      // Saat diaktifkan kembali → tampilkan animasi sinkronisasi
      if (isActive === false) {
        setRestartingIds(prev => new Map([...prev, [id, Date.now()]]))
        toast.success('Channel diaktifkan, sinkronisasi ulang...')
      } else {
        toast.success('Channel dijeda')
      }
      setTimeout(load, 3000)
    } catch (err) { toast.error(err.message) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.del(`/v1/channels/${deleteTarget.id}`)
      setDeleteTarget(null)
      toast.success('Channel berhasil dihapus')
      load()
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(false) }
  }

  const handleForceLogout = async (id) => {
    setActionLoading(prev => ({ ...prev, [id]: 'logout' }))
    try {
      await api.post(`/v1/channels/${id}/force-logout`)
      toast.success('Force logout berhasil')
      setTimeout(load, 2000)
    } catch (err) { toast.error(err.message) }
    finally { setActionLoading(prev => ({ ...prev, [id]: null })) }
  }

  const handleCleanBrowser = async () => {
    if (!cleanTarget) return
    setActionLoading(prev => ({ ...prev, [cleanTarget.id]: 'clean' }))
    try {
      await api.post(`/v1/channels/${cleanTarget.id}/clean-browser`)
      // Tandai channel sebagai restarting agar animasi sinkronisasi muncul
      setRestartingIds(prev => new Map([...prev, [cleanTarget.id, Date.now()]]))
      setCleanTarget(null)
      toast.success('Channel sedang di-restart dan akan sinkronisasi ulang')
      setTimeout(load, 3000)
    } catch (err) { toast.error(err.message) }
    finally { setActionLoading(prev => ({ ...prev, [cleanTarget?.id]: null })) }
  }

  // ── Edit channel ──────────────────────────────────────
  const openEdit = (channel) => {
    setEditTarget(channel)
    setEditForm({ scraping_config: { username: '', password: '' }, qris_data: '' })
    setEditError(null)
    setEditQrisInfo(null)
    setTestResult(null)
  }

  const closeEdit = () => {
    setEditTarget(null)
    setEditError(null)
    setEditQrisInfo(null)
    setTestResult(null)
  }

  const handleEditQrFile = async (file) => {
    if (!file) return
    setEditError(null)
    try {
      const qrisString = await decodeQrFromFile(file)
      const info = parseQrisString(qrisString)
      if (!info.valid) { setEditError('QR code bukan QRIS yang valid'); return }
      setEditQrisInfo(info)
      setEditForm(prev => ({ ...prev, qris_data: qrisString }))
    } catch (err) { setEditError(err.message) }
  }

  const handleEditSave = async (e) => {
    e.preventDefault()
    setEditError(null)
    const body = {}

    // Credentials update (only if filled)
    if (editForm.scraping_config.username.trim() && editForm.scraping_config.password.trim()) {
      body.scraping_config = editForm.scraping_config
    } else if (editForm.scraping_config.username.trim() || editForm.scraping_config.password.trim()) {
      setEditError('Username dan password harus diisi keduanya')
      return
    }

    // QRIS data update
    if (editForm.qris_data) {
      body.qris_data = editForm.qris_data
    }

    if (Object.keys(body).length === 0) {
      setEditError('Tidak ada perubahan. Isi username & password baru, atau upload QR code baru.')
      return
    }

    setEditSubmitting(true)
    try {
      await api.patch(`/v1/channels/${editTarget.id}`, body)
      closeEdit()
      toast.success('Channel berhasil diupdate')
      load()
    } catch (err) {
      setEditError(err.message || 'Gagal mengupdate channel')
    } finally {
      setEditSubmitting(false)
    }
  }

  // ── Test connection ──────────────────────────────────
  const handleTestConnection = async (channelId) => {
    setActionLoading(prev => ({ ...prev, [channelId]: 'test' }))
    try {
      const res = await api.post(`/v1/channels/${channelId}/test-connection`)
      if (res.data.success) {
        toast.success(res.data.message)
      } else {
        toast.error(res.data.message)
      }
    } catch (err) {
      toast.error(err.message || 'Test koneksi gagal')
    } finally {
      setActionLoading(prev => ({ ...prev, [channelId]: null }))
    }
  }

  if (loading) return <SkeletonTable rows={4} cols={6} />

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payment Channel</h1>
          <p className="page-subtitle">Kelola channel pembayaran bank Anda</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}
          disabled={isFree || isAtLimit}
          title={isFree ? 'Upgrade ke Langganan untuk tambah channel' : isAtLimit ? `Batas maksimal ${maxChannels} channel telah tercapai` : ''}>
          <Plus size={16} /> Tambah Channel
        </button>
      </div>

      {/* Plan warning */}
      {isFree && (
        <div className="plan-warning">
          <Star size={20} className="plan-warning-icon" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Anda menggunakan Plan Gratis</div>
            <div className="text-sm text-muted" style={{ marginTop: 2 }}>
              Upgrade ke Langganan untuk menambahkan payment channel sendiri dan menerima dana langsung.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => router.push('/dashboard/billing')} style={{ whiteSpace: 'nowrap' }}>
            Upgrade Sekarang
          </button>
        </div>
      )}
      {isAtLimit && (
        <div className="plan-warning" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}>
          <AlertTriangle size={20} className="plan-warning-icon" style={{ color: 'var(--warning, #f59e0b)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Batas Channel Tercapai</div>
            <div className="text-sm text-muted" style={{ marginTop: 2 }}>
              Plan Anda mendukung maksimal <strong>{maxChannels} channel</strong>. Hapus channel yang tidak digunakan untuk menambahkan yang baru.
            </div>
          </div>
        </div>
      )}

      <div className="card mobile-cards">
        {channels.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Building2 size={48} strokeWidth={1} /></div>
            <div className="empty-state-text">Belum ada channel</div>
            <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={isFree}>
              <Plus size={16} /> Tambah Channel Pertama
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Tipe</th><th>Nama Akun</th><th>No. Rekening</th><th>Status</th><th>Sinkronisasi</th><th>Aksi</th></tr>
                </thead>
                <tbody>
                  {channels.map(c => (
                    <tr key={c.id}>
                      <td><span className="badge badge-info">{c.channel_type}</span></td>
                      <td>{c.account_name}</td>
                      <td className="font-mono">{c.account_number}</td>
                      <td><ChannelStatus c={c} onEdit={() => openEdit(c)} restartingIds={restartingIds} /></td>
                      <td><SyncInfo c={c} restartingIds={restartingIds} /></td>
                      <td><ChannelActions c={c} actionLoading={actionLoading} restartingIds={restartingIds} onTest={handleTestConnection} onToggle={handleToggle} onEdit={openEdit} onRestart={setCleanTarget} onForceLogout={handleForceLogout} onDelete={setDeleteTarget} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            {channels.map(c => (
              <div className="mobile-card" key={c.id}>
                <div className="mobile-card-header">
                  <div>
                    <div className="mobile-card-title">{c.account_name}</div>
                    <span className="badge badge-info" style={{ fontSize: '0.65rem', marginTop: 4 }}>{c.channel_type}</span>
                  </div>
                  <ChannelStatus c={c} onEdit={() => openEdit(c)} restartingIds={restartingIds} />
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">No. Rekening</span>
                  <span className="font-mono">{c.account_number}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Sinkronisasi</span>
                  <SyncInfo c={c} restartingIds={restartingIds} />
                </div>
                <div className="mobile-card-actions">
                  <ChannelActions c={c} actionLoading={actionLoading} restartingIds={restartingIds} onTest={handleTestConnection} onToggle={handleToggle} onEdit={openEdit} onRestart={setCleanTarget} onForceLogout={handleForceLogout} onDelete={setDeleteTarget} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="modal-title">Tambah Channel</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Tipe Channel</label>
                <select className="form-select" value={form.channel_type} onChange={e => {
                  setForm({ ...form, channel_type: e.target.value, qris_data: '', account_name: '', account_number: '' })
                  setQrisInfo(null)
                  setFormError(null)
                }}>
                  <option value="bca_transfer">BCA Transfer</option>
                  <option value="qris_bca">QRIS BCA</option>
                  <option value="qris_gopay">QRIS GoPay</option>
                </select>
              </div>

              {/* ── QRIS: QR Code Upload ─────────────────────── */}
              {isQris && (
                <div className="form-group">
                  <label className="form-label">Upload QR Code QRIS *</label>
                  <div
                    onDragOver={e => { e.preventDefault(); setQrisDragging(true) }}
                    onDragLeave={() => setQrisDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${qrisDragging ? 'var(--primary)' : qrisInfo ? 'var(--success)' : 'var(--border)'}`,
                      borderRadius: 12,
                      padding: '24px 16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: qrisDragging ? 'rgba(59,130,246,0.05)' : qrisInfo ? 'rgba(34,197,94,0.05)' : 'transparent'
                    }}
                  >
                    {qrisDecoding ? (
                      <div style={{ color: 'var(--text-muted)' }}>
                        <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 8px' }}></div>
                        Membaca QR code...
                      </div>
                    ) : qrisInfo ? (
                      <div>
                        <CheckCircle size={32} style={{ color: 'var(--success)', marginBottom: 8 }} />
                        <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
                          {qrisInfo.merchantName}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          NMID: {qrisInfo.merchantId || '-'} • {qrisInfo.merchantCity || '-'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginTop: 8, cursor: 'pointer' }}>
                          Klik untuk ganti QR code
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)' }}>
                        <Upload size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                        <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                          Drag & drop gambar QR code di sini
                        </div>
                        <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          atau klik untuk pilih file (PNG, JPG)
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => handleQrFile(e.target.files?.[0])}
                  />
                </div>
              )}

              {/* ── Bank Transfer: no rek + nama akun ──────── */}
              {!isQris && (
                <>
                  <div className="form-group">
                    <label className="form-label">Nomor Rekening BCA *</label>
                    <div style={{ position: 'relative' }}>
                      <input type="text" className="form-input"
                        placeholder="Nomor rekening BCA (10-15 digit)"
                        value={form.account_number}
                        style={{ paddingRight: 36 }}
                        onChange={e => {
                          const num = e.target.value.replace(/\D/g, '')
                          setForm(prev => ({ ...prev, account_number: num, account_name: '' }))
                          setAcctChecked(null)
                          setFormError(null)
                          clearTimeout(checkTimerRef.current)
                          if (num.length >= 8) {
                            checkTimerRef.current = setTimeout(() => checkBcaAccount(num), 800)
                          }
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
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: 4 }}>Nomor rekening BCA tidak ditemukan</div>
                    )}
                  </div>

                  {/* Nama Akun: hanya muncul setelah verifikasi sukses */}
                  {acctChecked && acctChecked !== 'error' && (
                    <div className="form-group">
                      <label className="form-label">Nama Pemilik Rekening</label>
                      <input type="text" className="form-input"
                        value={form.account_name}
                        readOnly
                        style={{ background: 'rgba(34,197,94,0.06)', fontWeight: 600, cursor: 'default' }} />
                      <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle size={11} /> Terverifikasi
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Credentials (always shown) ──────────────── */}
              <div className="form-group">
                <label className="form-label">
                  {isQrisBca ? 'Email QRIS BCA Merchant' : isQrisGopay ? 'Email GoBiz (GoPay Merchant)' : isQris ? 'Username QRIS Merchant' : 'Username Internet Banking'} *
                </label>
                <input type={isQrisEmail ? 'email' : 'text'} className="form-input" value={form.scraping_config.username}
                  placeholder={isQrisGopay ? 'email@example.com' : ''}
                  onChange={e => { setForm({ ...form, scraping_config: { ...form.scraping_config, username: e.target.value } }); setFormError(null) }} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input type="password" className="form-input" value={form.scraping_config.password}
                  onChange={e => { setForm({ ...form, scraping_config: { ...form.scraping_config, password: e.target.value } }); setFormError(null) }} required />
              </div>

              {formError && <div className="form-error-box">{formError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={submitting}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Memproses...' : 'Tambah'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="modal-title">Edit Channel: {editTarget.account_name}</h3>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              <span className="badge badge-info">{editTarget.channel_type}</span>
              <span style={{ marginLeft: 8 }}>{editTarget.account_number}</span>
            </div>
            <form onSubmit={handleEditSave}>
              {/* Credentials */}
              <div className="form-group">
                <label className="form-label">Username Baru</label>
                <input type="text" className="form-input" placeholder="Kosongkan jika tidak diubah"
                  value={editForm.scraping_config.username}
                  onChange={e => setEditForm({ ...editForm, scraping_config: { ...editForm.scraping_config, username: e.target.value } })} />
              </div>
              <div className="form-group">
                <label className="form-label">Password Baru</label>
                <input type="password" className="form-input" placeholder="Kosongkan jika tidak diubah"
                  value={editForm.scraping_config.password}
                  onChange={e => setEditForm({ ...editForm, scraping_config: { ...editForm.scraping_config, password: e.target.value } })} />
              </div>

              {/* QRIS: re-upload QR */}
              {editTarget.channel_type.startsWith('qris_') && (
                <div className="form-group">
                  <label className="form-label">Ganti QR Code QRIS</label>
                  <div
                    onClick={() => editFileRef.current?.click()}
                    style={{
                      border: `2px dashed ${editQrisInfo ? 'var(--success)' : 'var(--border)'}`,
                      borderRadius: 12,
                      padding: '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: editQrisInfo ? 'rgba(34,197,94,0.05)' : 'transparent'
                    }}
                  >
                    {editQrisInfo ? (
                      <div>
                        <CheckCircle size={24} style={{ color: 'var(--success)', marginBottom: 4 }} />
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{editQrisInfo.merchantName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>NMID: {editQrisInfo.merchantId || '-'}</div>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        <Upload size={20} style={{ marginBottom: 4, opacity: 0.5 }} />
                        <div>Klik untuk upload QR code baru (opsional)</div>
                      </div>
                    )}
                  </div>
                  <input ref={editFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => handleEditQrFile(e.target.files?.[0])} />
                </div>
              )}


              {editError && <div className="form-error-box">{editError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeEdit} disabled={editSubmitting}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                  {editSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Channel?"
        message={deleteTarget ? `Yakin ingin menghapus channel ${deleteTarget.account_name}? Tindakan ini tidak dapat dibatalkan.` : ''}
        confirmText={deleting ? 'Menghapus...' : 'Ya, Hapus'}
        loading={deleting}
      />

      <ConfirmModal
        open={!!cleanTarget}
        onClose={() => setCleanTarget(null)}
        onConfirm={handleCleanBrowser}
        title="Restart Channel?"
        message={cleanTarget ? `${cleanTarget.account_name} akan di-restart dan sinkronisasi otomatis.` : ''}
        confirmText="Ya, Restart"
        variant="primary"
        icon={RotateCcw}
      />
    </>
  )
}

function timeAgo(dateStr) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return `${diff}s lalu`
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h lalu`
  return `${Math.floor(diff / 86400)}d lalu`
}

function timeUntil(dateStr) {
  const now = Date.now()
  const target = new Date(dateStr).getTime()
  const diff = Math.floor((target - now) / 1000)
  if (diff <= 0) return 'Sekarang'
  if (diff < 60) return `${diff} detik`
  if (diff < 3600) return `${Math.floor(diff / 60)} menit`
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam`
  return `${Math.floor(diff / 86400)} hari`
}

function ChannelStatus({ c, onEdit, restartingIds }) {
  const isRestarting = restartingIds?.has(c.id)
  return (
    <div>
      <span className={`badge badge-${c.is_active ? 'success' : 'danger'}`}>
        {c.is_active ? 'Aktif' : 'Nonaktif'}
      </span>
      {c.is_active && c.session_active && !isRestarting && (
        <div style={{ marginTop: 4 }}>
          <span className="badge badge-success" style={{ opacity: 0.7, fontSize: '0.65rem' }}>Terhubung</span>
        </div>
      )}
      {c.is_active && !isRestarting && c.last_error_type === 'transient' && c.last_error_message && (
        <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(245,158,11,0.08)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--warning, #f59e0b)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> Ditunda
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{c.last_error_message}</div>
        </div>
      )}
      {!c.is_active && c.last_error_type === 'fatal' && c.last_error_message && (
        <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> Login Gagal
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{c.last_error_message}</div>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.7rem', padding: '2px 8px', marginTop: 4, color: 'var(--primary)' }} onClick={onEdit}>
            <Pencil size={10} /> Perbaiki
          </button>
        </div>
      )}
    </div>
  )
}

function SyncInfo({ c, restartingIds }) {
  if (!c.is_active) return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>

  // Belum pernah berhasil scrape ATAU sedang restart → tampilkan animasi sinkronisasi
  // KECUALI: sudah ada transient error (rate-limit dsb) → proses sudah selesai, tampilkan info waktu
  const isRestarting = restartingIds?.has(c.id)
  const isApiBased = c.channel_type === 'qris_gopay'
  const hasTransientError = c.last_error_type === 'transient'
  // Spinner tampil hanya jika belum ada hasil apapun (first sync) atau sedang restart
  // Jika sudah ada transient error → scraper sudah selesai, langsung tampilkan next_scrape_at
  const showSpinner = isRestarting || (!c.last_success_at && !hasTransientError)
  if (showSpinner) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="spinner" style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Sinkronisasi...
          </span>
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 3 }}>
          {isApiBased ? 'memerlukan waktu ±5 detik' : 'memerlukan waktu ±30 detik, harap tunggu'}
        </div>
      </div>
    )
  }

  return (
    <div>
      {c.last_success_at ? (
        <div style={{ fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Terakhir: </span>
          <span style={{ fontWeight: 500 }}>{timeAgo(c.last_success_at)}</span>
        </div>
      ) : (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Belum berhasil</div>
      )}
      {c.next_scrape_at && (
        <div style={{ fontSize: '0.8rem', marginTop: 2 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Berikutnya: </span>
          <span style={{ fontWeight: 500 }}>{timeUntil(c.next_scrape_at)}</span>
        </div>
      )}
    </div>
  )
}

function ChannelActions({ c, actionLoading, restartingIds, onTest, onToggle, onEdit, onRestart, onForceLogout, onDelete }) {
  // Sinkronisasi pertama: last_success_at null dan tidak ada error fatal
  const isSyncing = (!c.last_success_at && c.is_active && c.last_error_type !== 'fatal') || restartingIds?.has(c.id)
  // Gagal login: error fatal, channel nonaktif
  const isFatalError = !c.is_active && c.last_error_type === 'fatal'

  if (isFatalError) {
    // Hanya tampilkan Edit dan Hapus — tombol lain tidak relevan
    return (
      <div className="flex gap-1" style={{ flexWrap: 'nowrap' }}>
        <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => onEdit(c)}>
          <Pencil size={14} />
        </button>
        <button className="btn btn-danger btn-sm" title="Hapus" onClick={() => onDelete(c)} disabled={actionLoading[c.id] === 'deleting'}>
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-1" style={{ flexWrap: 'nowrap' }}>
      {/* Test koneksi — disembunyikan sementara (Pause/Restart sudah handle sinkronisasi)
      <button className="btn btn-ghost btn-sm" title="Test koneksi" onClick={() => onTest(c.id)} disabled={isSyncing || actionLoading[c.id] === 'test'}>
        <Wifi size={14} />
      </button> */}
      <button className="btn btn-ghost btn-sm" title={c.is_active ? 'Pause' : 'Aktifkan'} onClick={() => onToggle(c.id, c.is_active)} disabled={isSyncing}>
        {c.is_active ? <Pause size={14} /> : <Play size={14} />}
      </button>
      {/* Paksa Logout — disembunyikan sementara (Pause/Restart sudah handle sinkronisasi)
      <button className="btn btn-ghost btn-sm" title="Paksa Logout" onClick={() => onForceLogout(c.id)} disabled={isSyncing || actionLoading[c.id] === 'logout'}>
        <Lock size={14} />
      </button>
      */}
      <button className="btn btn-ghost btn-sm" title="Restart" onClick={() => onRestart(c)} disabled={isSyncing || !c.is_active || actionLoading[c.id] === 'clean' || c.channel_type === 'qris_gopay'}>
        <RotateCcw size={14} />
      </button>
      <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => onEdit(c)} disabled={isSyncing}>
        <Pencil size={14} />
      </button>
      <button className="btn btn-danger btn-sm" title="Hapus" onClick={() => onDelete(c)} disabled={isSyncing || actionLoading[c.id] === 'deleting'}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}
