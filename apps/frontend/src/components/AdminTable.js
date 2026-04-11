'use client'

/**
 * AdminTable — Responsive table component for admin pages.
 * - Desktop: renders a standard HTML table
 * - Mobile: renders stacked card layouts
 *
 * Props:
 *   columns: [{ key, label, hide? }]  — column definitions
 *   data: [{}]                        — array of row objects
 *   loading: boolean
 *   emptyText: string
 *   renderRow: (item) => { cells: { [key]: ReactNode }, accent?, actions?: ReactNode }
 *   pagination?: { page, totalPages, onPrev, onNext }
 *   cardTitle?: (item) => ReactNode   — what to show as card header on mobile
 *   cardAccent?: (item) => string     — accent color for card top border
 */
export default function AdminTable({
  columns = [],
  data = [],
  loading = false,
  emptyText = 'Tidak ada data',
  renderRow,
  pagination,
  cardTitle,
  cardAccent,
}) {
  const colSpan = columns.length

  return (
    <div className="card admin-table-card">
      {/* ── Desktop: Table ────────────────────────── */}
      <div className="table-wrap admin-table-desktop">
        <table>
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} style={{ textAlign: 'center', padding: 32 }}>
                  <div className="spinner" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colSpan} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  {emptyText}
                </td>
              </tr>
            ) : data.map((item, i) => {
              const row = renderRow(item)
              return (
                <tr key={item.id || i} style={row.rowStyle}>
                  {columns.map(col => (
                    <td key={col.key}>{row.cells[col.key]}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile: Cards ─────────────────────────── */}
      <div className="admin-table-mobile">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div className="spinner" />
          </div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            {emptyText}
          </div>
        ) : data.map((item, i) => {
          const row = renderRow(item)
          const accent = cardAccent ? cardAccent(item) : null
          const title = cardTitle ? cardTitle(item) : null
          // Filter out columns marked as hide on mobile
          const visibleCols = columns.filter(c => !c.hide)

          return (
            <div
              key={item.id || i}
              className="admin-mobile-card"
              style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
            >
              {title && (
                <div className="admin-mobile-card-header">
                  {title}
                </div>
              )}
              {visibleCols.map(col => {
                const val = row.cells[col.key]
                if (val === undefined || val === null) return null
                return (
                  <div key={col.key} className="admin-mobile-card-row">
                    <span className="admin-mobile-card-label">{col.label}</span>
                    <span className="admin-mobile-card-value">{val}</span>
                  </div>
                )
              })}
              {row.actions && (
                <div className="admin-mobile-card-actions">
                  {row.actions}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Pagination ────────────────────────────── */}
      {pagination && pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 24px' }}>
          <button className="btn btn-sm btn-ghost" disabled={pagination.page <= 1} onClick={pagination.onPrev}>
            ← Prev
          </button>
          <span style={{ padding: '6px 12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {pagination.page} / {pagination.totalPages}
          </span>
          <button className="btn btn-sm btn-ghost" disabled={pagination.page >= pagination.totalPages} onClick={pagination.onNext}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
