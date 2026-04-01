'use client'
// apps/frontend/src/lib/AuthContext.js

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // tokenVersion increments every time a new access token is set.
  // SSE connections can depend on this to restart with the fresh token.
  const [tokenVersion, setTokenVersion] = useState(0)

  const bumpToken = useCallback((token) => {
    api.setToken(token)
    setTokenVersion(v => v + 1)
  }, [])

  useEffect(() => {
    api.onSessionExpired(() => {
      localStorage.removeItem('has_session')
      setUser(null)
    })
    // When api.js silently refreshes an access token (auto-retry on 401),
    // bump tokenVersion so SSE connections restart with the fresh token.
    api.onTokenRefreshed((newToken) => {
      setTokenVersion(v => v + 1)
    })

    // Skip /me call entirely if user was never logged in.
    // This prevents 2 unnecessary API round-trips (me + refresh) on public pages.
    const hasSession = localStorage.getItem('has_session') === '1'
    if (!hasSession) {
      setLoading(false)
      return
    }

    const restoreSession = async () => {
      try {
        if (!api.getToken()) {
          // No in-memory token (page refreshed) — use /restore to get token + user in 1 call
          // instead of: GET /me (401) → POST /refresh → GET /me (3 calls)
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/v1/auth/restore`, {
            method: 'POST',
            credentials: 'include'
          })
          const data = await res.json()
          if (!data.success) {
            localStorage.removeItem('has_session')
            setUser(null)
            return
          }
          bumpToken(data.data.access_token)
          setUser(data.data.user)
        } else {
          // Token still in memory (client-side navigation) — just verify
          const me = await api.get('/v1/auth/me')
          setUser(me.data)
        }
      } catch {
        api.clearToken()
        localStorage.removeItem('has_session')
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    restoreSession()
  }, [])

  const login = async (email, password) => {
    const res = await api.post('/v1/auth/login', { email, password })
    bumpToken(res.data.access_token)
    localStorage.setItem('has_session', '1')
    const me = await api.get('/v1/auth/me')
    setUser(me.data)
    return me.data
  }

  const register = async (name, email, password, turnstileToken) => {
    // Tidak auto-login setelah register — user harus verifikasi email dulu
    await api.post('/v1/auth/register', { name, email, password, turnstileToken })
    // Return email agar halaman register tahu untuk menampilkan pesan "cek email"
    return { email }
  }

  const loginWithGoogle = async (idToken) => {
    const res = await api.post('/v1/auth/google', { idToken })
    bumpToken(res.data.access_token)
    localStorage.setItem('has_session', '1')
    const me = await api.get('/v1/auth/me')
    setUser(me.data)
    return me.data
  }

  const logout = async () => {
    try { await api.post('/v1/auth/logout') } catch {}
    api.clearToken()
    localStorage.removeItem('has_session')
    setUser(null)
  }

  const refreshUser = async () => {
    try {
      const me = await api.get('/v1/auth/me')
      setUser(me.data)
    } catch {}
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithGoogle, logout, refreshUser, tokenVersion }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * Untuk halaman PUBLIK (login, register, landing page).
 * Jika user sudah authenticated, redirect ke `to` (default: /dashboard).
 * Return { loading } agar halaman bisa render null selama auth check berjalan.
 */
export function useRedirectIfAuthenticated(to = '/dashboard') {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) router.replace(to)
  }, [user, loading, router, to])

  // Selama loading atau sudah login (redirect sedang berlangsung), sembunyikan konten
  return { loading: loading || !!user }
}

/**
 * Untuk halaman PROTECTED (dashboard, settings, dll).
 * Jika user belum authenticated, redirect ke `to` (default: /login).
 * Return { user, loading } untuk dipakai komponen.
 */
export function useRequireAuth(to = '/login') {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace(to)
  }, [user, loading, router, to])

  return { user, loading }
}
