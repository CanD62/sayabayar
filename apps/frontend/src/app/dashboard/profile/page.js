'use client'
import { useState } from 'react'
import { useAuth, useRequireAuth } from '@/lib/AuthContext'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import {
  User, Mail, Phone, Shield, Calendar, Key,
  Save, Eye, EyeOff, AlertTriangle
} from 'lucide-react'

export default function ProfilePage() {
  const { user, loading: authLoading } = useRequireAuth()
  const { refreshUser } = useAuth()
  const toast = useToast()

  // Profile form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileInit, setProfileInit] = useState(false)

  // Password form
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Init form with user data
  if (user && !profileInit) {
    setName(user.name || '')
    setPhone(user.phone || '')
    setProfileInit(true)
  }

  if (authLoading || !user) {
    return <div className="loading"><div className="spinner"></div></div>
  }

  const isGoogleOnly = user.auth_provider === 'google' && !user.has_password
  const fmtDate = (d) => new Date(d).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setProfileLoading(true)
    try {
      await api.patch('/v1/auth/profile', { name, phone })
      await refreshUser()
      toast.success('Profil berhasil diperbarui')
    } catch (err) {
      toast.error(err.message || 'Gagal menyimpan profil')
    } finally {
      setProfileLoading(false)
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('Password baru dan konfirmasi tidak cocok')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password minimal 8 karakter')
      return
    }
    setPasswordLoading(true)
    try {
      const body = { newPassword }
      // Google-only user doesn't need oldPassword
      if (!isGoogleOnly) body.oldPassword = oldPassword
      await api.post('/v1/auth/change-password', body)
      toast.success('Password berhasil diubah')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // Refresh user to update has_password status
      await refreshUser()
    } catch (err) {
      toast.error(err.message || 'Gagal mengubah password')
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Profil</h1>
          <p className="page-subtitle">Kelola informasi akun Anda</p>
        </div>
      </div>

      {/* Account Info Card */}
      <div className="profile-info-card">
        <div className="profile-avatar-section">
          <div className="profile-avatar-large">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.name} className="profile-avatar-img" />
            ) : (
              user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="profile-identity">
            <h2 className="profile-name">{user.name}</h2>
            <p className="profile-email">{user.email}</p>
            <div className="profile-badges">
              <span className="badge badge-success">
                <Shield size={10} />
                {user.status}
              </span>
              <span className="badge badge-info">
                {user.auth_provider === 'google' ? '🔗 Google' : '📧 Email'}
              </span>
              {user.plan && (
                <span className="badge badge-warning">
                  ⭐ {user.plan.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="profile-meta">
          <div className="profile-meta-item">
            <Calendar size={14} />
            <span>Bergabung {fmtDate(user.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="profile-grid">
        {/* Edit Profile */}
        <div className="card">
          <div className="card-header-row">
            <User size={18} />
            <h3 className="card-section-title">Informasi Profil</h3>
          </div>

          <form onSubmit={handleProfileSave}>
            <div className="form-group">
              <label className="form-label">Nama</label>
              <div className="form-input-icon">
                <User size={16} className="form-icon" />
                <input
                  type="text"
                  className="form-input form-input-with-icon"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama lengkap"
                  required
                  minLength={2}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <div className="form-input-icon">
                <Mail size={16} className="form-icon" />
                <input
                  type="email"
                  className="form-input form-input-with-icon"
                  value={user.email}
                  disabled
                />
              </div>
              <span className="form-hint">Email tidak dapat diubah</span>
            </div>

            <div className="form-group">
              <label className="form-label">No. Telepon</label>
              <div className="form-input-icon">
                <Phone size={16} className="form-icon" />
                <input
                  type="text"
                  className="form-input form-input-with-icon"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={profileLoading} style={{ width: '100%' }}>
              <Save size={16} />
              {profileLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </form>
        </div>

        {/* Change Password */}
        <div className="card">
          <div className="card-header-row">
            <Key size={18} />
            <h3 className="card-section-title">
              {isGoogleOnly ? 'Buat Password' : 'Ganti Password'}
            </h3>
          </div>

          {isGoogleOnly && (
            <div className="form-info-box" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Akun Anda terdaftar via Google. Anda bisa membuat password untuk login alternatif menggunakan email & password.</span>
            </div>
          )}

          <form onSubmit={handlePasswordChange}>
            {!isGoogleOnly && (
              <div className="form-group">
                <label className="form-label">Password Lama</label>
                <div className="form-input-icon">
                  <Key size={16} className="form-icon" />
                  <input
                    type={showOld ? 'text' : 'password'}
                    className="form-input form-input-with-icon"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="Password lama"
                    required
                  />
                  <button type="button" className="form-icon-right" onClick={() => setShowOld(!showOld)}>
                    {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Password Baru</label>
              <div className="form-input-icon">
                <Key size={16} className="form-icon" />
                <input
                  type={showNew ? 'text' : 'password'}
                  className="form-input form-input-with-icon"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                  required
                  minLength={8}
                />
                <button type="button" className="form-icon-right" onClick={() => setShowNew(!showNew)}>
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Konfirmasi Password Baru</label>
              <div className="form-input-icon">
                <Key size={16} className="form-icon" />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  className="form-input form-input-with-icon"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ketik ulang password baru"
                  required
                  minLength={8}
                />
                <button type="button" className="form-icon-right" onClick={() => setShowConfirm(!showConfirm)}>
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={passwordLoading} style={{ width: '100%' }}>
              <Key size={16} />
              {passwordLoading ? 'Mengubah...' : isGoogleOnly ? 'Buat Password' : 'Ganti Password'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
