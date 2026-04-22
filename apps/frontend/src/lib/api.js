// apps/frontend/src/lib/api.js
// API client — wraps fetch with auth token handling

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

class ApiClient {
  constructor() {
    this.accessToken = null
    this._onSessionExpired = null // callback dipanggil saat refresh token habis
    this._onTokenRefreshed = null // callback dipanggil saat access token di-refresh otomatis
    // One-time migration: remove any token left in localStorage from previous
    // versions of the app. Access tokens are now stored in memory only.
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token')
    }
  }

  /** AuthContext memasang callback ini untuk handle session expired */
  onSessionExpired(cb) {
    this._onSessionExpired = cb
  }

  /** AuthContext memasang callback ini agar tokenVersion naik setelah auto-refresh berhasil */
  onTokenRefreshed(cb) {
    this._onTokenRefreshed = cb
  }

  setToken(token) {
    // Store in memory only — never localStorage (mitigates XSS token theft)
    this.accessToken = token
  }

  getToken() {
    return this.accessToken
  }

  clearToken() {
    this.accessToken = null
  }

  async request(path, options = {}) {
    const { method = 'GET', body, headers: extraHeaders = {} } = options

    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders
    }

    const token = this.getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    let res
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : (method !== 'GET' ? '{}' : undefined),
        credentials: 'include' // for refresh token cookie
      })
    } catch {
      // Network error: API server down, ECONNREFUSED, timeout, dll
      const err = new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.')
      err.code = 'NETWORK_ERROR'
      err.status = 0
      throw err
    }

    // Parse JSON — API bisa return non-JSON saat crash (DB down, OOM, dll)
    let data
    try {
      data = await res.json()
    } catch {
      // Server return non-JSON (HTML error page, empty body, dll)
      const err = new Error(
        res.status >= 500
          ? 'Server sedang mengalami gangguan. Coba beberapa saat lagi.'
          : 'Respons server tidak valid.'
      )
      err.code = res.status >= 500 ? 'SERVER_ERROR' : 'INVALID_RESPONSE'
      err.status = res.status
      throw err
    }

    // Auto refresh on 401
    // PENTING: skip retry jika 401 intentional (salah password), bukan token expired.
    // Error code dari API seperti INVALID_CREDENTIALS menandakan 401-nya disengaja.
    if (res.status === 401 && !options._retried) {
      const intentional401 = data?.error?.code &&
        ['INVALID_CREDENTIALS', 'WITHDRAWAL_PASSWORD_LOCKED'].includes(data.error.code)

      if (!intentional401) {
        const refreshed = await this.refresh()
        if (refreshed) {
          return this.request(path, { ...options, _retried: true })
        }
        // Token + refresh keduanya expired — beri tahu AuthContext via callback.
        // Jangan hard-redirect di sini: halaman publik (landing page) juga pakai
        // api.request dan tidak boleh diforce-redirect ke /login.
        // Redirect dilakukan oleh dashboard/layout.js yang watch user === null.
        this.clearToken()
        this._onSessionExpired?.()
      }
    }

    // Handle 5xx — server error (DB down, dll)
    if (res.status >= 500) {
      const err = new Error(data.error?.message || 'Server sedang mengalami gangguan. Coba beberapa saat lagi.')
      err.code = data.error?.code || 'SERVER_ERROR'
      err.status = res.status
      throw err
    }

    if (!data.success && res.status >= 400) {
      let message = data.error?.message || 'Request failed'

      // Untuk VALIDATION_ERROR, tambahkan detail field-level ke pesan utama
      const details = data.error?.details
      if (details?.length) {
        const detailStr = details
          .map(d => {
            const fieldLabel = d.field ? `${d.field}: ` : ''
            // Terjemahkan pesan validasi Ajv yang teknis ke bahasa yang lebih mudah dipahami
            let msg = d.message || ''
            msg = msg.replace(/must be >= (\d+)/, (_, n) => `minimal Rp ${Number(n).toLocaleString('id-ID')}`)
            msg = msg.replace(/must be <= (\d+)/, (_, n) => `maksimal Rp ${Number(n).toLocaleString('id-ID')}`)
            msg = msg.replace(/must be integer/, 'harus bilangan bulat')
            msg = msg.replace(/must be string/, 'harus berupa teks')
            msg = msg.replace(/must have required property '(.+)'/, "field '$1' wajib diisi")
            return `${fieldLabel}${msg}`
          })
          .join(', ')
        message = `${message} — ${detailStr}`
      }

      const err = new Error(message)
      err.code = data.error?.code
      err.status = res.status
      err.details = details
      throw err
    }

    return data
  }

  async refresh() {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success) {
        this.setToken(data.data.access_token)
        // Notify AuthContext — tokenVersion akan naik, SSE restart dengan token baru
        this._onTokenRefreshed?.(data.data.access_token)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // ── Shortcuts ───────────────────────────────────────────
  get(path) { return this.request(path) }
  post(path, body) { return this.request(path, { method: 'POST', body }) }
  patch(path, body) { return this.request(path, { method: 'PATCH', body }) }
  del(path) { return this.request(path, { method: 'DELETE' }) }

  /** Upload multipart FormData (for file uploads like KYC) */
  async upload(path, formData, _retried = false) {
    const token = this.getToken()
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    // Don't set Content-Type — browser sets it automatically with boundary

    let res
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include'
      })
    } catch {
      const err = new Error('Tidak dapat terhubung ke server.')
      err.code = 'NETWORK_ERROR'
      throw err
    }

    let data
    try { data = await res.json() } catch {
      const err = new Error('Respons server tidak valid.')
      err.code = 'INVALID_RESPONSE'
      err.status = res.status
      throw err
    }

    // Auto refresh on 401 (same behavior as request())
    if (res.status === 401 && !_retried) {
      const intentional401 = data?.error?.code &&
        ['INVALID_CREDENTIALS', 'WITHDRAWAL_PASSWORD_LOCKED'].includes(data.error.code)

      if (!intentional401) {
        const refreshed = await this.refresh()
        if (refreshed) {
          return this.upload(path, formData, true)
        }
        this.clearToken()
        this._onSessionExpired?.()
      }
    }

    if (!data.success && res.status >= 400) {
      const err = new Error(data.error?.message || 'Upload failed')
      err.code = data.error?.code
      err.status = res.status
      throw err
    }

    return data
  }
}

export const api = new ApiClient()
