'use client'
// components/BankSelect.js
// Searchable bank/e-wallet dropdown dengan fitur pencarian real-time

import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'

/**
 * BankSelect — custom searchable dropdown untuk pilih bank/e-wallet
 * Props:
 *   banks      — array [{ code, name, popular, isEwallet }]
 *   value      — string (code terpilih)
 *   onChange   — fn(code: string)
 *   placeholder— string
 *   required   — bool
 *   disabled   — bool
 */
export default function BankSelect({ banks = [], value, onChange, placeholder = '— Pilih Bank / E-Wallet —', required, disabled }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rect, setRect] = useState(null)  // posisi fixed dropdown
  const wrapRef   = useRef(null)
  const btnRef    = useRef(null)
  const searchRef = useRef(null)

  const selected = banks.find(b => b.code === value) || null

  // Hitung posisi dropdown berdasarkan posisi tombol
  const updateRect = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  // Buka dropdown
  const openDropdown = useCallback(() => {
    updateRect()
    setOpen(true)
  }, [updateRect])

  // Tutup saat klik di luar
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Update posisi saat scroll / resize (agar tidak drift)
  useEffect(() => {
    if (!open) return
    const update = () => updateRect()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, updateRect])

  // Fokus ke search saat dropdown buka
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  // Filter berdasarkan query
  const q = query.toLowerCase().trim()
  const filtered = q
    ? banks.filter(b => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q))
    : banks

  const popular  = filtered.filter(b => b.popular)
  const others   = filtered.filter(b => !b.popular && !b.isEwallet)
  const ewallets = filtered.filter(b => b.isEwallet)

  const handleSelect = useCallback((code) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }, [onChange])

  const handleClear = (e) => {
    e.stopPropagation()
    onChange('')
    setQuery('')
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Tombol trigger */}
      <button
        type="button"
        ref={btnRef}
        disabled={disabled}
        onClick={() => !disabled && (open ? (setOpen(false), setQuery('')) : openDropdown())}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--input-bg, var(--surface))',
          border: `1px solid ${open ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius: 10,
          color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: '0.9rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 0.15s',
          textAlign: 'left',
          boxShadow: open ? '0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent)' : 'none',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {selected.isEwallet && (
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', color: 'var(--primary)' }}>
                  E-Wallet
                </span>
              )}
              {selected.popular && (
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: 'var(--success)' }}>
                  ★
                </span>
              )}
              {selected.name}
            </span>
          ) : placeholder}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {selected && !disabled && (
            <span
              onMouseDown={handleClear}
              style={{ padding: 2, borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown
            size={16}
            style={{
              color: 'var(--text-muted)',
              transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'none',
              flexShrink: 0,
            }}
          />
        </span>
      </button>

      {/* Hidden input for form required validation */}
      {required && (
        <input
          tabIndex={-1}
          style={{ opacity: 0, height: 0, position: 'absolute', width: '100%' }}
          required={required}
          value={value || ''}
          onChange={() => {}}
        />
      )}

      {/* Dropdown panel — position:fixed agar tidak terpotong modal overflow */}
      {open && rect && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top:    rect.top,
            left:   rect.left,
            width:  rect.width,
            zIndex: 9999,
            background: 'var(--bg-card, #1a1c24)',
            backgroundColor: 'var(--bg-card, #1a1c24)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            overflow: 'hidden',
            isolation: 'isolate',
          }}>
          {/* Search input */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card, #1a1c24)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Cari bank atau e-wallet..."
                style={{
                  width: '100%',
                  padding: '7px 12px 7px 30px',
                  background: 'var(--bg-input, #101218)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Results */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Tidak ada bank yang cocok
              </div>
            )}
            {popular.length > 0 && (
              <>
                <GroupLabel label="★ Bank Populer" />
                {popular.map(b => <BankOption key={b.code} bank={b} selected={value === b.code} onSelect={handleSelect} query={q} />)}
              </>
            )}
            {others.length > 0 && (
              <>
                <GroupLabel label="Bank Lainnya" />
                {others.map(b => <BankOption key={b.code} bank={b} selected={value === b.code} onSelect={handleSelect} query={q} />)}
              </>
            )}
            {ewallets.length > 0 && (
              <>
                <GroupLabel label="E-Wallet" />
                {ewallets.map(b => <BankOption key={b.code} bank={b} selected={value === b.code} onSelect={handleSelect} query={q} />)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function GroupLabel({ label }) {
  return (
    <div style={{
      padding: '6px 14px 4px',
      fontSize: '0.68rem',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      background: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid var(--border)',
    }}>
      {label}
    </div>
  )
}

function BankOption({ bank, selected, onSelect, query }) {
  // Highlight matched text
  const highlight = (text, q) => {
    if (!q) return text
    const idx = text.toLowerCase().indexOf(q)
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'rgba(59,130,246,0.2)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onSelect(bank.code) }}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        background: selected ? 'rgba(59,130,246,0.08)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-primary)',
        fontSize: '0.88rem',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-card-hover, #22252e)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Badge */}
      {bank.isEwallet ? (
        <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', color: '#a78bfa', flexShrink: 0 }}>
          Wallet
        </span>
      ) : bank.popular ? (
        <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', flexShrink: 0 }}>
          ★
        </span>
      ) : (
        <span style={{ width: 28, flexShrink: 0 }} />
      )}

      <span style={{ flex: 1 }}>{highlight(bank.name, query)}</span>

      {selected && (
        <span style={{ color: 'var(--primary)', flexShrink: 0, fontSize: '0.85rem' }}>✓</span>
      )}
    </button>
  )
}
