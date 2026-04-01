'use client'
import { useEffect, useRef, useCallback } from 'react'

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

/**
 * Google Sign-In button using Google Identity Services (GSI).
 * Loads the GSI script once, then renders the branded button.
 *
 * @param {{ onToken: (idToken: string) => void, label?: string }} props
 */
export default function GoogleSignInButton({ onToken, label = 'signin_with' }) {
  const btnRef = useRef(null)
  const initialized = useRef(false)

  const handleResponse = useCallback((response) => {
    if (response.credential) {
      onToken(response.credential)
    }
  }, [onToken])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    const renderButton = () => {
      if (initialized.current || !btnRef.current) return
      initialized.current = true

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleResponse,
        ux_mode: 'popup',
      })

      window.google.accounts.id.renderButton(btnRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: label,
        shape: 'rectangular',
        logo_alignment: 'left',
        width: btnRef.current.offsetWidth || 340,
      })
    }

    // If GSI script already loaded
    if (window.google?.accounts?.id) {
      renderButton()
      return
    }

    // Load GSI script
    if (!document.getElementById('google-gsi-script')) {
      const script = document.createElement('script')
      script.id = 'google-gsi-script'
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = renderButton
      document.head.appendChild(script)
    } else {
      // Script tag exists but not loaded yet — wait for it
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval)
          renderButton()
        }
      }, 100)
      return () => clearInterval(interval)
    }
  }, [handleResponse, label])

  if (!GOOGLE_CLIENT_ID) return null

  return <div ref={btnRef} className="google-btn-wrap" />
}
