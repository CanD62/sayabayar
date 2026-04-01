'use client'

export function Skeleton({ width, height = 16, radius = 6, style = {} }) {
  return (
    <div
      className="skeleton"
      style={{
        width: width || '100%',
        height,
        borderRadius: radius,
        ...style
      }}
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 20 }}>
      <Skeleton height={12} width="40%" style={{ marginBottom: 12 }} />
      <Skeleton height={28} width="60%" style={{ marginBottom: 8 }} />
      <Skeleton height={12} width="30%" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="card">
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <Skeleton height={16} width="120px" />
      </div>
      <div style={{ padding: 16 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} height={14} width={`${60 + Math.random() * 40}%`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
