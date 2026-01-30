'use client'

type AdminPanelProps = {
  teamsCsv: string
  setTeamsCsv: (v: string) => void
  playersCsv: string
  setPlayersCsv: (v: string) => void

  importTeamsFromCsv: () => Promise<void>
  replaceTeamsFromCsv: () => Promise<void>
  importPlayersFromCsv: () => Promise<void>
  replacePlayersFromCsv: () => Promise<void>
  resetDraft: () => Promise<void>

  adminNominationHours: number
  setAdminNominationHours: (n: number) => void
  adminBidHours: number
  setAdminBidHours: (n: number) => void
  saveDraftSettings: () => Promise<void>
}

export default function AdminPanel(props: AdminPanelProps) {
  const {
    teamsCsv, setTeamsCsv,
    playersCsv, setPlayersCsv,
    importTeamsFromCsv, replaceTeamsFromCsv,
    importPlayersFromCsv, replacePlayersFromCsv,
    resetDraft,
    adminNominationHours, setAdminNominationHours,
    adminBidHours, setAdminBidHours,
    saveDraftSettings,
  } = props

  return (
    <details className="card">
      <summary>Admin Tools</summary>

      <div style={{ marginTop: 12 }}>
        {/* Timer settings */}
        <section style={{ marginTop: 16 }}>
          <h2 className="section-title">Admin: Draft Timer Settings</h2>
          <p className="help">
            These settings apply to all users. Nomination sets the starting time for new auctions.
            Each bid guarantees at least the bid timer (hours) remaining.
          </p>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <label>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Nomination timer (hours)
              </div>
              <input
                type="number"
                min={1}
                value={adminNominationHours}
                onChange={(e) => setAdminNominationHours(parseInt(e.target.value || '12', 10))}
                style={{ width: '100%' }}
              />
            </label>

            <label>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Bid timer (hours)
              </div>
              <input
                type="number"
                min={0}
                value={adminBidHours}
                onChange={(e) => setAdminBidHours(parseInt(e.target.value || '12', 10))}
                style={{ width: '100%' }}
              />
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={saveDraftSettings}>
              Save Timer Settings
            </button>
          </div>
        </section>

        {/* Import teams */}
        <section style={{ marginTop: 24 }}>
          <h2 className="section-title">Admin: Import Teams</h2>
          <p className="help">
            Paste CSV with headers <b>name,budget,spots</b>.
          </p>

          <textarea
            style={{ width: '100%', height: 120, fontFamily: 'monospace' }}
            value={teamsCsv}
            onChange={(e) => setTeamsCsv(e.target.value)}
          />

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={importTeamsFromCsv}>Import Teams</button>
            <button className="btn" onClick={replaceTeamsFromCsv}>Replace Teams</button>
          </div>
        </section>

        {/* Import players */}
        <section style={{ marginTop: 24 }}>
          <h2 className="section-title">Admin: Import Players</h2>
          <p className="help">
            Paste CSV with headers <b>name,position_primary,position_secondary</b>.
            Secondary position is optional.
          </p>

          <textarea
            style={{ width: '100%', height: 160, fontFamily: 'monospace' }}
            value={playersCsv}
            onChange={(e) => setPlayersCsv(e.target.value)}
          />

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={importPlayersFromCsv}>Import Players</button>
            <button className="btn" onClick={replacePlayersFromCsv}>Replace Undrafted Players</button>

            <button
              className="btn btn-danger"
              onClick={resetDraft}
              title="Deletes all auctions and clears drafted players"
            >
              Reset Draft (Admin)
            </button>
          </div>
        </section>
      </div>
    </details>
  )
}