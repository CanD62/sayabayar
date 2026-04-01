'use client'
import { createContext, useContext, useRef, useCallback } from 'react'

/**
 * InvoiceEventContext
 * Allows the dashboard layout (which owns the SSE connection) to notify
 * child pages (e.g. InvoicesPage) to refresh their data.
 *
 * Usage:
 *   Layout  → call emit(eventName) when SSE fires
 *   Page    → call onEvent(handler) to subscribe, returns unsubscribe fn
 */
const InvoiceEventContext = createContext(null)

export function InvoiceEventProvider({ children }) {
  const listenersRef = useRef(new Set())

  const emit = useCallback((eventName, payload) => {
    listenersRef.current.forEach(fn => fn(eventName, payload))
  }, [])

  const onEvent = useCallback((handler) => {
    listenersRef.current.add(handler)
    return () => listenersRef.current.delete(handler)
  }, [])

  return (
    <InvoiceEventContext.Provider value={{ emit, onEvent }}>
      {children}
    </InvoiceEventContext.Provider>
  )
}

export function useInvoiceEvents() {
  return useContext(InvoiceEventContext)
}
