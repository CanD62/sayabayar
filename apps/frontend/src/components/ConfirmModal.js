'use client'
import { AlertTriangle } from 'lucide-react'

export default function ConfirmModal({ open, onClose, onConfirm, title, message, confirmText = 'Ya, Lanjutkan', cancelText = 'Batal', variant = 'danger', loading = false, icon }) {
  if (!open) return null

  const Icon = icon || AlertTriangle

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div className={`confirm-icon confirm-icon-${variant}`}>
            <Icon size={28} />
          </div>
          <h3 className="modal-title" style={{ marginBottom: 8 }}>{title}</h3>
          <p className="text-sm text-muted">{message}</p>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>{cancelText}</button>
          <button className={`btn btn-${variant}`} onClick={onConfirm} disabled={loading}>
            {loading ? 'Memproses...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
