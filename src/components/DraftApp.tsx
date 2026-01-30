'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Papa from 'papaparse'

type Team = {
  id: string
  name: string
  join_code?: string | null
  budget_remaining: number
  roster_spots_total: number
  roster_spots_remaining: number
}

type Player = {
  id: string
  name: string
  metadata: any
  drafted_by_team_id: string | null
  winning_bid: number | null
}

type DraftState = {
  draft_id: string
  nominated_player_id: string | null
  high_bid: number
  high_team_id: string | null
  ends_at: string | null
}

type Auction = {
  id: string
  draft_id: string
  player_id: string
  nominated_by_team_id: string
  high_bid: number
  high_team_id: string | null
  ends_at: string
  last_bid_at: string | null
  closed_at: string | null
}

type DraftSettings = {
  draft_id: string
  nomination_hours: number
  bid_hours: number
}

const DRAFT_ID = process.env.NEXT_PUBLIC_DRAFT_ID ?? ''

const PRIMARY_POSITIONS = new Set(['C','1B','2B','SS','3B','RF','CF','LF'])
const SECONDARY_POSITIONS = new Set(['C','1B','2B','SS','3B','RF','CF','LF','IF','OF','IF/OF','1B/OF'])

function normPos(s: unknown) {
  return String(s ?? '').trim().toUpperCase()
}

export default function DraftApp({ showAdmin }: { showAdmin: boolean }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [selectedAuctionId, setSelectedAuctionId] = useState('')

  const [state, setState] = useState<DraftState | null>(null)

  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState('')

  const [playerSearch, setPlayerSearch] = useState('')

  const [positionFilter, setPositionFilter] = useState('ALL')

  const [bidAmount, setBidAmount] = useState<number>(1)
  const [error, setError] = useState<string>('')

  const [nowTick, setNowTick] = useState(Date.now())

  const [teamCode, setTeamCode] = useState('')
const [lockedTeamId, setLockedTeamId] = useState<string>('')

  const [settings, setSettings] = useState<DraftSettings | null>(null)
  const [adminNominationHours, setAdminNominationHours] = useState<number>(12)
const [adminBidHours, setAdminBidHours] = useState<number>(12)

  useEffect(() => {
  const t = setInterval(() => setNowTick(Date.now()), 1000)
  return () => clearInterval(t)
}, [])

useEffect(() => {
  if (showAdmin) return // admin doesn't need a locked team
  const saved = localStorage.getItem('locked_team_id')
  if (saved) {
    setLockedTeamId(saved)
    setSelectedTeamId(saved)
  }
}, [showAdmin])

useEffect(() => {
  if (!settings) return
  setAdminNominationHours(settings.nomination_hours ?? 12)
  setAdminBidHours(settings.bid_hours ?? 12)
}, [settings])

  const [teamsCsv, setTeamsCsv] = useState('name,budget,spots\nTeam A,200,23\nTeam B,200,23')
  const [playersCsv, setPlayersCsv] = useState('name,rating,position\nPlayer One,78,F\nPlayer Two,82,G')

  function playerCanPlayPosition(p: Player, targetPos: string) {
  const t = (targetPos ?? '').toUpperCase()
  if (t === 'ALL') return true

  const primary = String(p.metadata?.position_primary ?? '').toUpperCase()
  const secondary = String(p.metadata?.position_secondary ?? '').toUpperCase()


  // Direct matches
  if (primary === t) return true
  if (secondary === t) return true

  // Expand "group" secondaries
  // IF can play 1B,2B,SS,3B
  if (secondary === 'IF') return ['1B', '2B', 'SS', '3B'].includes(t)

  // OF can play RF,CF,LF
  if (secondary === 'OF') return ['RF', 'CF', 'LF'].includes(t)

  // IF/OF can play all except C
  if (secondary === 'IF/OF') return t !== 'C'

  // 1B/OF can play 1B,RF,CF,LF
  if (secondary === '1B/OF') return ['1B', 'RF', 'CF', 'LF'].includes(t)

  return false
}
 const filteredUndraftedPlayers = players
  .filter((p) => !p.drafted_by_team_id)
  .filter((p) => {
    const name = (p.name ?? '').trim().toLowerCase()
    const q = playerSearch.trim().toLowerCase()
    return q === '' ? true : name.includes(q)
  })
  .filter((p) => playerCanPlayPosition(p, positionFilter))
  .slice()
  .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

  const nominatedPlayer = useMemo(() => {
    if (!state?.nominated_player_id) return null
    return players.find(p => p.id === state.nominated_player_id) ?? null
  }, [state, players])

  const selectedAuction = auctions.find(a => a.id === selectedAuctionId) ?? null
const selectedAuctionPlayer = selectedAuction
  ? (players.find(p => p.id === selectedAuction.player_id) ?? null)
  : null

const selectedAuctionHighTeamName = selectedAuction?.high_team_id
  ? (teams.find(t => t.id === selectedAuction.high_team_id)?.name ?? 'Unknown')
  : '—'

  async function loadAll() {
    if (!DRAFT_ID) {
      // setError('Missing NEXT_PUBLIC_DRAFT_ID in .env.local')
      return
    }

    setError('')
const [teamsRes, playersRes, auctionsRes, stateRes, settingsRes] = await Promise.all([
  supabase
    .from('teams')
    .select('id,name,join_code,budget_remaining,roster_spots_total,roster_spots_remaining')
    .eq('draft_id', DRAFT_ID)
    .order('name'),

  supabase
    .from('players')
    .select('id,name,metadata,drafted_by_team_id,winning_bid')
    .eq('draft_id', DRAFT_ID)
    .order('name'),

  supabase
    .from('auctions')
    .select('id,draft_id,player_id,nominated_by_team_id,high_bid,high_team_id,ends_at,last_bid_at,closed_at')
    .eq('draft_id', DRAFT_ID)
    .is('closed_at', null)
    .order('ends_at'),

  supabase
    .from('draft_state')
    .select('*')
    .eq('draft_id', DRAFT_ID)
    .single(),

  supabase
    .from('draft_settings')
    .select('draft_id,nomination_hours,bid_hours')
    .eq('draft_id', DRAFT_ID)
    .single(),
])

    if (teamsRes.error) return setError(teamsRes.error.message)
    if (playersRes.error) return setError(playersRes.error.message)
    if (auctionsRes.error) return setError(auctionsRes.error.message)
    if (stateRes.error) return setError(stateRes.error.message)
    if (settingsRes.error) return setError(settingsRes.error.message)

    setTeams(teamsRes.data ?? [])
    setPlayers(playersRes.data ?? [])
    setAuctions(auctionsRes.data ?? [])
    setState(stateRes.data ?? null)
    setSettings(settingsRes.data ?? null)
    
  }

  async function importTeamsFromCsv() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')

  const parsed = Papa.parse(teamsCsv.trim(), { header: true, skipEmptyLines: true })
  if (parsed.errors.length) return setError(parsed.errors[0].message)

  const rows = (parsed.data as any[])
  .map((r) => {
    const code = String(r.code ?? r.join_code ?? '').trim()
    const name = String(r.name ?? '').trim()
    const budget = parseInt(String(r.budget ?? ''), 10)
    const spots = parseInt(String(r.spots ?? r.roster_spots ?? r.roster_spots_total ?? ''), 10)

    return {
      draft_id: DRAFT_ID,
      name,
      join_code: code,
      budget_total: Number.isFinite(budget) ? budget : 200,
      budget_remaining: Number.isFinite(budget) ? budget : 200,
      roster_spots_total: Number.isFinite(spots) ? spots : 0,
      roster_spots_remaining: Number.isFinite(spots) ? spots : 0,
    }
  })
  .filter((r) => r.name)

  const firstErr = (rows as any[]).find((x) => x?.error)?.error
if (firstErr) return setError(firstErr)

  if (!rows.length) return setError('No valid team rows found.')
    if (rows.some(r => !Number.isFinite(r.roster_spots_total) || r.roster_spots_total <= 0)) {
  return setError('Each team must have a valid spots value (> 0). CSV headers must include: name,budget,spots')
}
if (rows.some(r => !r.join_code)) {
  return setError('Each team must have a non-empty code. CSV headers must include: name,budget,spots,code')
}

  const res = await supabase
  .from('teams')
  .upsert(rows, { onConflict: 'draft_id,name' })
  if (res.error) return setError(res.error.message)

  await supabase.from('draft_events').insert({
    draft_id: DRAFT_ID,
    event_type: 'IMPORT_TEAMS',
    payload: { count: rows.length },
  })

  await loadAll()
}

function joinTeamByCode() {
  setError('')
  const code = teamCode.trim()
  if (!code) {
    setError('Enter your team code.')
    return
  }

  const match = teams.find(t => String(t.join_code ?? '').trim() === code)
  if (!match) {
    setError('Invalid team code.')
    return
  }

  setLockedTeamId(match.id)
  setSelectedTeamId(match.id)
  localStorage.setItem('locked_team_id', match.id)
  localStorage.setItem('locked_team_code', code)
  setTeamCode('')
}

function leaveTeam() {
  localStorage.removeItem('locked_team_id')
  localStorage.removeItem('locked_team_code')
  setLockedTeamId('')
  setSelectedTeamId('')
}

async function saveDraftSettings() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')

  const res = await supabase
    .from('draft_settings')
    .upsert({
      draft_id: DRAFT_ID,
      nomination_hours: adminNominationHours,
      bid_hours: adminBidHours,
    })

  if (res.error) return setError(res.error.message)

  await loadAll()
}

async function forceFinalizeNow(auctionId: string) {
  if (!showAdmin) return setError('Admin only.')

  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  const ok = window.confirm(
    'Force finalize this auction right now? This will draft the current high bidder (if any) and close the auction.'
  )
  if (!ok) return

  setError(`Force finalizing auction ${auctionId}...`)

  const res = await fetch('/api/finalize-force', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({ auction_id: auctionId }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return setError(data?.error ?? 'Force finalize failed.')

  const status = String(data?.status ?? 'UNKNOWN')
  setError(`Force finalize status: ${status}`)
  await loadAll()
}

async function replaceTeamsFromCsv() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')

  const ok = window.confirm(
    'Replace Teams will remove ALL current teams for this draft and load the teams from the CSV.\n\nRecommended: Run Reset Draft first.\n\nContinue?'
  )
  if (!ok) return

  // 0) Safety check: draft should be "empty" (no auctions, no drafted players)
  const [openAuctionsRes, draftedPlayersRes] = await Promise.all([
    supabase
      .from('auctions')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', DRAFT_ID),
    supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', DRAFT_ID)
      .not('drafted_by_team_id', 'is', null),
  ])

  if (openAuctionsRes.error) return setError(openAuctionsRes.error.message)
  if (draftedPlayersRes.error) return setError(draftedPlayersRes.error.message)

  const auctionsCount = openAuctionsRes.count ?? 0
  const draftedCount = draftedPlayersRes.count ?? 0

  if (auctionsCount > 0 || draftedCount > 0) {
    return setError(
      `Cannot replace teams while draft has data.\nAuctions: ${auctionsCount}, Drafted players: ${draftedCount}.\n\nRun Reset Draft first, then replace teams.`
    )
  }

  // 1) Parse CSV
  const parsed = Papa.parse(teamsCsv.trim(), { header: true, skipEmptyLines: true })
  if (parsed.errors.length) return setError(parsed.errors[0].message)

  const rows = (parsed.data as any[])
    .map((r) => {
      const name = String(r.name ?? '').trim()
      const budget = parseInt(String(r.budget ?? '200'), 10)
      const spots = parseInt(String(r.spots ?? '23'), 10)

      if (!name) return null
      if (!Number.isFinite(budget) || budget <= 0) return { error: `Invalid budget for "${name}".` }
      if (!Number.isFinite(spots) || spots < 0) return { error: `Invalid spots for "${name}".` }

      return {
        draft_id: DRAFT_ID,
        name,
        budget_total: budget,
        budget_remaining: budget,
        roster_spots_total: spots,
        roster_spots_remaining: spots,
      }
    })
    .filter(Boolean)

  const firstErr = (rows as any[]).find((x) => x?.error)?.error
  if (firstErr) return setError(firstErr)

  if (!rows.length) return setError('No valid team rows found.')

  // 2) Delete existing teams for this draft
  const del = await supabase
    .from('teams')
    .delete()
    .eq('draft_id', DRAFT_ID)

  if (del.error) return setError(del.error.message)

  // 3) Insert/upsert new teams
  const up = await supabase
    .from('teams')
    .upsert(rows, { onConflict: 'draft_id,name' })

  if (up.error) return setError(up.error.message)

  await supabase.from('draft_events').insert({
    draft_id: DRAFT_ID,
    event_type: 'REPLACE_TEAMS',
    payload: { count: rows.length },
  })

  await loadAll()
}

async function resetDraft() {
  if (!DRAFT_ID) {
    setError('Missing DRAFT_ID.')
    return
  }

  const ok = window.confirm(
    'RESET DRAFT: This will delete all auctions, clear drafted players, and reset team budgets/roster spots. Continue?'
  )
  if (!ok) return

  setError('Resetting draft...')

  const res = await supabase.rpc('reset_draft', { p_draft_id: DRAFT_ID })
  if (res.error) {
    setError(`Reset error: ${res.error.message}`)
    return
  }

  setSelectedAuctionId('')
  setSelectedPlayerId('')
  setBidAmount(1)
  setPlayerSearch('')

  setError('Draft reset complete.')
  await loadAll()
}

function teamCommittedHighBids(teamId: string) {
  return auctions
    .filter((a) => a.high_team_id === teamId && !a.closed_at)
    .reduce((sum, a) => sum + (a.high_bid ?? 0), 0)
}

function teamAvailableBudget(team: Team) {
  const committed = teamCommittedHighBids(team.id)
  return Math.max(0, (team.budget_remaining ?? 0) - committed)
}

function teamAvailableBudgetForBid(team: Team, auction: Auction) {
  // Total currently committed to active high bids by this team
  const committed = teamCommittedHighBids(team.id)

  // If this team is already the high bidder on THIS auction,
  // their committed amount already includes auction.high_bid.
  // When they raise their bid, they should "get credit" for that existing commitment.
  const credit = auction.high_team_id === team.id ? (auction.high_bid ?? 0) : 0

  return Math.max(0, (team.budget_remaining ?? 0) - (committed - credit))
}

async function importPlayersFromCsv() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')

  const raw = playersCsv.trim()
  if (!raw) return setError('Players CSV is empty.')

  // Accept either:
  // 1) no header:  John Doe,SS,2B
  // 2) header:     name,primary,secondary
  const firstLine = raw.split(/\r?\n/)[0] ?? ''
  const hasHeader = firstLine.toLowerCase().includes('name')

  const parsed = Papa.parse(raw, {
    header: hasHeader,
    skipEmptyLines: true,
  })

  if (parsed.errors.length) return setError(parsed.errors[0].message)

  const rows = (parsed.data as any[])
    .map((r) => {
      let name = ''
      let primary = ''
      let secondary = ''

      if (hasHeader) {
        name = String(r.name ?? '').trim()
        primary = normPos(r.primary ?? r.pos1 ?? r.position_primary)
        secondary = normPos(r.secondary ?? r.pos2 ?? r.position_secondary)
      } else {
        // headerless: columns 0,1,2
        const arr = Array.isArray(r) ? r : []
        name = String(arr[0] ?? '').trim()
        primary = normPos(arr[1])
        secondary = normPos(arr[2])
      }

      if (!name) return null

      // Validate positions (primary required)
      if (!primary) return { error: `Missing primary position for "${name}".` }
      if (!PRIMARY_POSITIONS.has(primary)) return { error: `Invalid primary position "${primary}" for "${name}".` }

      if (secondary && !SECONDARY_POSITIONS.has(secondary)) {
        return { error: `Invalid secondary position "${secondary}" for "${name}".` }
      }

      const metadata: any = {
        position_primary: primary,
      }
      if (secondary) metadata.position_secondary = secondary

      return { draft_id: DRAFT_ID, name, metadata }
    })
    .filter(Boolean)

  // If any row returned an {error: "..."} object, show first error
  const firstErr = (rows as any[]).find((x) => x?.error)?.error
  if (firstErr) return setError(firstErr)

  if (!rows.length) return setError('No valid player rows found.')

  const res = await supabase
    .from('players')
    .upsert(rows as any[], { onConflict: 'draft_id,name' })

  if (res.error) return setError(res.error.message)

  await supabase.from('draft_events').insert({
    draft_id: DRAFT_ID,
    event_type: 'IMPORT_PLAYERS',
    payload: { count: rows.length },
  })

  await loadAll()
}

function formatRemaining(ms: number) {
  if (ms <= 0) return '00:00'

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

async function replacePlayersFromCsv() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')

  // Clear current nomination BEFORE deleting players (FK safety)
  const clearNom = await supabase
    .from('draft_state')
    .update({
      nominated_player_id: null,
      high_bid: 0,
      high_team_id: null,
      ends_at: null,
      last_bid_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('draft_id', DRAFT_ID)

  if (clearNom.error) return setError(clearNom.error.message)

  // Delete ONLY undrafted players
// 1) Get IDs of undrafted players (the ones we plan to remove)
const undraftedRes = await supabase
  .from('players')
  .select('id')
  .eq('draft_id', DRAFT_ID)
  .is('drafted_by_team_id', null)

if (undraftedRes.error) return setError(undraftedRes.error.message)

const undraftedIds = (undraftedRes.data ?? []).map((r) => r.id)

if (undraftedIds.length > 0) {
  // 2) Delete auctions that reference these undrafted players (prevents FK violation)
  const delAuctions = await supabase
    .from('auctions')
    .delete()
    .eq('draft_id', DRAFT_ID)
    .in('player_id', undraftedIds)

  if (delAuctions.error) return setError(delAuctions.error.message)

  // 3) Now delete the undrafted players
  const delPlayers = await supabase
    .from('players')
    .delete()
    .eq('draft_id', DRAFT_ID)
    .in('id', undraftedIds)

  if (delPlayers.error) return setError(delPlayers.error.message)
}

  await supabase.from('draft_events').insert({
    draft_id: DRAFT_ID,
    event_type: 'REPLACE_UNDRAFTED_PLAYERS_CLEAR',
    payload: {},
  })

  // Import the CSV using the same validation + upsert logic
  await importPlayersFromCsv()
}

  useEffect(() => {
    loadAll()

    if (!DRAFT_ID) return

    // Realtime subscriptions: reload when DB changes.
    const channel = supabase
      .channel(`draft-${DRAFT_ID}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_state', filter: `draft_id=eq.${DRAFT_ID}` }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `draft_id=eq.${DRAFT_ID}` }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `draft_id=eq.${DRAFT_ID}` }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_events', filter: `draft_id=eq.${DRAFT_ID}` }, () => loadAll())
      .subscribe()
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `draft_id=eq.${DRAFT_ID}` }, () => loadAll())
    const finalizeTimer = setInterval(() => {
  autoFinalizeExpiredAuctionsFromDb()
}, 15000)

   return () => {
  clearInterval(finalizeTimer)
  supabase.removeChannel(channel)
}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function nominate() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')
  if (!selectedPlayerId) return setError('Pick a player to nominate.')

const nominationHours = settings?.nomination_hours ?? 12
const ends = new Date(Date.now() + nominationHours * 60 * 60 * 1000)

// Admin only: nominations are done by admin
if (!showAdmin) return setError('Only admin can nominate.')

const adminCode = localStorage.getItem('admin_code') ?? ''
if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

const res = await fetch('/api/nominate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-code': adminCode,
  },
body: JSON.stringify({
  draft_id: DRAFT_ID,
  player_id: selectedPlayerId,
}),
})

const data = await res.json().catch(() => ({}))
if (!res.ok) return setError(data?.error ?? 'Nomination failed.')

setSelectedAuctionId(String(data.auction_id ?? ''))
setBidAmount(1)
await loadAll()
}

  async function placeBid() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')
    if (!showAdmin && lockedTeamId && selectedTeamId !== lockedTeamId) {
  setSelectedTeamId(lockedTeamId)
}
  if (!selectedAuctionId) return setError('Select an auction to bid on.')
if (!selectedTeamId) return setError(showAdmin ? 'Pick your team (who is bidding).' : 'Join your team first.')
  if (!bidAmount || bidAmount <= 0) return setError('Enter a valid bid.')

  const auction = auctions.find(a => a.id === selectedAuctionId)
  if (!auction) return setError('Selected auction not found. Refresh and try again.')
    if (new Date() > new Date(auction.ends_at)) return setError('This auction has ended. Wait for auto-finalize or pick another auction.')

  const minInc = 1
  const requiredMin = (auction.high_bid ?? 0) + minInc
  if (bidAmount < requiredMin) return setError(`Bid must be at least ${requiredMin}.`)

  const team = teams.find(t => t.id === selectedTeamId)
  if (!team) return setError('Unknown team.')
    if ((team.roster_spots_remaining ?? 0) <= 0) {
  return setError('Your team has no roster spots remaining and cannot bid.')
}
  const available = teamAvailableBudgetForBid(team, auction)
if (bidAmount > available) return setError(`Bid exceeds your available budget (${available}).`)

  const bidHours = settings?.bid_hours ?? 12
const minEndsMs = Date.now() + bidHours * 60 * 60 * 1000
const currentEndsMs = new Date(auction.ends_at).getTime()
const newEndsMs = Math.max(currentEndsMs, minEndsMs)
const newEnds = new Date(newEndsMs)

// Users: require team code. Admin: we can use the team’s join_code if present.
let code = ''
if (!showAdmin) {
  code = localStorage.getItem('locked_team_code') ?? ''
  if (!code) return setError('Join your team first.')
} else {
  // admin can bid as any selected team (optional)
  code = String(team.join_code ?? '').trim()
}

const res = await fetch('/api/bid', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    draft_id: DRAFT_ID,
    auction_id: selectedAuctionId,
    team_code: code,
    bid_amount: bidAmount,
  }),
})

const data = await res.json().catch(() => ({}))
if (!res.ok) return setError(data?.error ?? 'Bid failed.')

await loadAll()
}

 async function finalize() {
  setError('')
  if (!DRAFT_ID) return setError('Missing DRAFT_ID.')
  if (!selectedAuctionId) return setError('Select an auction to finalize.')

  const auction = auctions.find(a => a.id === selectedAuctionId)
  if (!auction) return setError('Selected auction not found.')

  if (!auction.high_team_id || !auction.high_bid) return setError('No bids to finalize.')

  const ends = new Date(auction.ends_at)
  if (new Date() < ends) return setError('Bidding window not ended yet.')

  const winningTeamId = auction.high_team_id
  const winningBid = auction.high_bid
  const playerId = auction.player_id

  const pUp = await supabase
    .from('players')
    .update({ drafted_by_team_id: winningTeamId, winning_bid: winningBid })
    .eq('id', playerId)

  if (pUp.error) return setError(pUp.error.message)

  const team = teams.find(t => t.id === winningTeamId)
  if (!team) return setError('Winning team not found in UI. Refresh and try again.')

    if (team.roster_spots_remaining <= 0) return setError('Winning team has no roster spots remaining.')

  const tUp = await supabase
  .from('teams')
  .update({
    budget_remaining: team.budget_remaining - winningBid,
    roster_spots_remaining: team.roster_spots_remaining - 1,
  })
  .eq('id', winningTeamId)

  if (tUp.error) return setError(tUp.error.message)

  const aUp = await supabase
    .from('auctions')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', selectedAuctionId)

  if (aUp.error) return setError(aUp.error.message)

  await supabase.from('draft_events').insert({
    draft_id: DRAFT_ID,
    event_type: 'FINALIZE',
    payload: { auction_id: selectedAuctionId, team_id: winningTeamId, amount: winningBid, player_id: playerId },
  })

  setSelectedAuctionId('')
  await loadAll()
}

async function autoFinalizeExpiredAuctionsFromDb() {
  setError('') // optional; remove if you don't want this to clear errors

  if (!DRAFT_ID) return

  // 1) Fetch expired, still-open auctions directly from DB (no stale React state)
  const expiredRes = await supabase
    .from('auctions')
    .select('id')
    .eq('draft_id', DRAFT_ID)
    .is('closed_at', null)
    .lte('ends_at', new Date().toISOString())

  if (expiredRes.error) {
    setError(expiredRes.error.message)
    return
  }

  const expired = expiredRes.data ?? []
  if (expired.length === 0) return

  // 2) Finalize each expired auction via RPC (safe if multiple clients try)
  for (const row of expired) {
    const rpcRes = await supabase.rpc('finalize_auction', { p_auction_id: row.id })
    if (rpcRes.error) {
      // Don't stop the whole loop; show the first error
      setError(rpcRes.error.message)
    }
  }

  // 3) Refresh UI state after finalization
  await loadAll()
}

async function autoFinalizeExpiredAuctions() {
  if (!DRAFT_ID) return

  const now = Date.now()
  const expired = auctions.filter(
    (a) => !a.closed_at && new Date(a.ends_at).getTime() <= now
  )

  if (expired.length === 0) return

  // Finalize each expired auction via the DB function (safe even if multiple clients run it)
  for (const a of expired) {
    const res = await supabase.rpc('finalize_auction', { p_auction_id: a.id })
    // If you want to debug statuses:
    // console.log('finalize_auction', a.id, res.data, res.error)
  }

  // Refresh after attempts
  await loadAll()
}

async function finalizeNow(auctionId: string) {
  if (!showAdmin) return setError('Admin only.')

  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  setError(`Finalizing auction ${auctionId}...`)

  const res = await fetch('/api/finalize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({ auction_id: auctionId }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return setError(data?.error ?? 'Finalize failed.')

  const status = String(data?.status ?? 'UNKNOWN')
  setError(`Finalize status: ${status}`)
  await loadAll()
}

return (
  <>
  <div className="header">
    <div className="header-inner">
      <div>
        <div className="header-title">Auction Draft</div>
        <div className="header-meta">Draft: {DRAFT_ID ?? 'Missing'}</div>
      </div>

      <div className="header-meta">
        Pending: {auctions.length} • Teams: {teams.length} • Players: {players.length}
      </div>
    </div>
  </div>

  <main className="container">
      <h1 className="h1">Auction Draft</h1>
      <p><b>Draft ID:</b> {DRAFT_ID ?? 'Missing'}</p>
      {!showAdmin && (
  <section className="card" style={{ marginTop: 12 }}>
    <h2 className="section-title">Join Your Team</h2>

    {lockedTeamId ? (
      <>
        <p className="help">
          Connected as:{' '}
          <b>{teams.find(t => t.id === lockedTeamId)?.name ?? 'Unknown team'}</b>
        </p>
        <button className="btn" onClick={leaveTeam}>
          Switch Team
        </button>
      </>
    ) : (
      <>
        <p className="help">Enter the team code provided by the admin.</p>

        <div className="btn-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password"
            value={teamCode}
            onChange={(e) => setTeamCode(e.target.value)}
            placeholder="Team code"
            style={{ padding: 10, minWidth: 220 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') joinTeamByCode()
            }}
          />
          <button className="btn btn-primary" onClick={joinTeamByCode}>
            Join
          </button>
        </div>
      </>
    )}
  </section>
)}

      {error && (
  <div className="alert alert-danger">
    Error: {error}
  </div>
)}

      <section className="card">
  <h2 className="section-title">Pending Auctions</h2>

  {auctions.length === 0 ? (
    <p>None</p>
  ) : (
    <table className="table">
      <thead>
        <tr>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Player</th>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Pos</th>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>High Bid</th>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>High Team</th>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Ends</th>
          {showAdmin && (
  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Actions</th>
)}
        </tr>
      </thead>
      <tbody>
        {auctions.map((a) => {
          const p = players.find(pp => pp.id === a.player_id)
          const pos1 = p?.metadata?.position_primary ?? ''
          const pos2 = p?.metadata?.position_secondary ?? ''
          const pos = pos2 ? `${pos1}, ${pos2}` : pos1
          const highTeamName = a.high_team_id
            ? (teams.find(t => t.id === a.high_team_id)?.name ?? 'Unknown')
            : '—'
          const ended = new Date(a.ends_at).getTime() <= nowTick

          return (
            <tr
              key={a.id}
              className={ended ? 'row-ended' : 'row-active'}
              onClick={() => setSelectedAuctionId(a.id)}
              style={{
                cursor: 'pointer',
                background: a.id === selectedAuctionId ? '#f2f2f2' : 'transparent'
              }}
            >
              <td className="td-strong">{p?.name ?? '(missing player)'}</td>
              <td className="td-strong">{pos || '—'}</td>
              <td className="td-right td-strong">{a.high_bid}</td>
              <td className="td-strong">{highTeamName}</td>
              <td className="td-strong">
{ended ? (
  <span className="badge badge-ended">Ended</span>
) : (
  <span className="badge badge-live">
    {formatRemaining(new Date(a.ends_at).getTime() - nowTick)}
  </span>
)}
<div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
  {new Date(a.ends_at).toLocaleString()}
</div>
</td>
{showAdmin && (
  <td style={{ padding: '6px 4px' }}>
    <div className="btn-row" style={{ display: 'flex', gap: 8 }}>
      <button
        className="btn"
        onClick={(e) => {
          e.stopPropagation()
          finalizeNow(a.id)
        }}
        title="Finalize after ends_at"
      >
        Finalize
      </button>

      <button
        className="btn btn-danger"
        onClick={(e) => {
          e.stopPropagation()
          forceFinalizeNow(a.id)
        }}
        title="Admin override: finalize before ends_at"
      >
        Force Finalize
      </button>
    </div>
  </td>
)}
            </tr>
          )
        })}
      </tbody>
    </table>
  )}
</section>

<section className="card">
  <h2 className="section-title">Teams Summary</h2>

  <table className="table">
    <thead>
      <tr>
        <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Team</th>
        <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Budget Remaining</th>
        <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Committed (High Bids)</th>
        <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Available Budget</th>
        <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Roster Spots Left</th>
      </tr>
    </thead>
    <tbody>
      {teams.map((t) => {
        const committed = teamCommittedHighBids(t.id)
        const available = teamAvailableBudget(t)

        return (
          <tr key={t.id} style={{ background: t.id === selectedTeamId ? '#f2f2f2' : 'transparent' }}>
            <td className="td-strong">{t.name}</td>
            <td className="td-right td-strong">{t.budget_remaining}</td>
            <td className="td-right td-strong">{committed}</td>
            <td className="td-right td-strong">{available}</td>
            <td className="td-right td-strong">{t.roster_spots_remaining}</td>
          </tr>
        )
      })}
    </tbody>
  </table>
</section>

      <section style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <h2 className="section-title">Team</h2>

{showAdmin ? (
  <select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
    <option value="">-- Select your team --</option>
    {teams.map(t => (
      <option key={t.id} value={t.id}>
        {t.name} (remaining: {t.budget_remaining})
      </option>
    ))}
  </select>
) : (
  <div className="help">
    {lockedTeamId
      ? <>You are bidding as <b>{teams.find(t => t.id === lockedTeamId)?.name ?? 'Unknown'}</b>.</>
      : <>Enter your team code above to join.</>}
  </div>
)}
        </div>

        <div>
          <h2 className="section-title">Nomination Status</h2>
          <p><b>Current:</b> {nominatedPlayer ? nominatedPlayer.name : 'None'}</p>
          <p>
            <b>High bid:</b> {state?.high_bid ?? 0}
            {state?.high_team_id ? ` (team: ${teams.find(t => t.id === state.high_team_id)?.name ?? 'unknown'})` : ''}
          </p>
          <p><b>Ends at:</b> {state?.ends_at ? new Date(state.ends_at).toLocaleString() : '—'}</p>
        </div>

        <div>
          <h2 className="section-title">Players (undrafted)</h2>
          <input
  type="text"
  placeholder="Search players..."
  value={playerSearch}
  onChange={(e) => {
    setPlayerSearch(e.target.value)
    setSelectedPlayerId('') // optional: clears selection when search changes
  }}
   onKeyDown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const first = filteredUndraftedPlayers[0]
      if (first) setSelectedPlayerId(first.id)
    }
  }}
  style={{ width: '100%', marginBottom: 8 }}
/>
<p className="help">
  Matches: {filteredUndraftedPlayers.length}
</p>

<label style={{ display: 'block', marginBottom: 8 }}>
  Filter by position:{' '}
  <select
    value={positionFilter}
    onChange={(e) => {
      setPositionFilter(e.target.value)
      setSelectedPlayerId('')
    }}
    style={{ marginLeft: 8 }}
  >
    <option value="ALL">All</option>
    <option value="C">C</option>
    <option value="1B">1B</option>
    <option value="2B">2B</option>
    <option value="SS">SS</option>
    <option value="3B">3B</option>
    <option value="LF">LF</option>
    <option value="CF">CF</option>
    <option value="RF">RF</option>
  </select>
</label>
          <select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)}>
            <option value="">-- Select a player --</option>
{filteredUndraftedPlayers.map((p) => (
  <option key={p.id} value={p.id}>
   {p.name}
{p.metadata?.position_primary ? ` — ${p.metadata.position_primary}` : ''}
{p.metadata?.position_secondary ? `, ${p.metadata.position_secondary}` : ''}
  </option>
))}
          </select>

          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={nominate}>Nominate</button>
        </div>

        <div>
          <h2 className="section-title">Place a Bid</h2>
          <div style={{ marginBottom: 12 }}>
  <div className="stat">
    <div className="stat-label">Selected Auction</div>
    <div className="stat-value">
      {selectedAuctionPlayer ? selectedAuctionPlayer.name : 'None selected'}
    </div>
  </div>

  <div className="stat">
    <div className="stat-label">Current High Bid</div>
    <div className={`stat-value ${selectedAuction?.high_bid ? 'primary' : ''}`}>
      ${selectedAuction?.high_bid ?? 0}
    </div>
  </div>

  <div className="stat">
    <div className="stat-label">High Team</div>
    <div className="stat-value">
      {selectedAuctionHighTeamName}
    </div>
  </div>

  <div className="stat">
    <div className="stat-label">Ends</div>
    <div className={`stat-value ${selectedAuction && new Date(selectedAuction.ends_at).getTime() <= nowTick ? 'danger' : ''}`}>
      {selectedAuction
        ? (new Date(selectedAuction.ends_at).getTime() <= nowTick
          ? 'Ended'
          : formatRemaining(new Date(selectedAuction.ends_at).getTime() - nowTick))
        : '—'}
    </div>
  </div>
</div>
          <label>
            Amount:{' '}
            <input
              type="number"
              min={1}
              value={bidAmount}
              onChange={(e) => setBidAmount(parseInt(e.target.value || '1', 10))}
            />
          </label>
          <div style={{ marginTop: 8 }}>
            <button
  className="btn btn-primary"
  onClick={placeBid}
  disabled={
    !selectedTeamId ||
    (teams.find(t => t.id === selectedTeamId)?.roster_spots_remaining ?? 0) <= 0
  }
>
  Place Bid
</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Drafted Players</h2>
        <ul>
          {players.filter(p => p.drafted_by_team_id).map(p => (
            <li key={p.id}>
              {p.name} — {teams.find(t => t.id === p.drafted_by_team_id)?.name ?? 'Unknown'} for {p.winning_bid}
            </li>
          ))}
        </ul>
      </section>


{showAdmin && (
<details className="card">
  <summary>Admin Tools</summary>
  <div style={{ marginTop: 12 }}>
    <section style={{ marginTop: 16 }}>
  <h2 className="section-title">Admin: Draft Timer Settings</h2>
  <p className="help">
    These settings apply to all users. Nomination sets the starting time for new auctions.
    Each bid extends the auction end time by the amount below.
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
      <section className="card">
  <h2>Admin: Import Teams</h2>
  <p className="help">
    Paste CSV with headers <b>name,budget,spots</b>. Example:
    <br />
    <code>name,budget,spots</code>
    <br />
    <code>Team A,200,21</code>
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

<section className="card">
  <h2>Admin: Import Players</h2>
  <p className="help">
    Paste CSV with headers <b>name,rating,position</b>. Rating/position are optional.
    <br />
    Example:
    <br />
    <code>name,rating,position</code>
    <br />
    <code>Player One,78,F</code>
  </p>

  <textarea
    style={{ width: '100%', height: 160, fontFamily: 'monospace' }}
    value={playersCsv}
    onChange={(e) => setPlayersCsv(e.target.value)}
  />

<div className="btn-row" style={{ marginTop: 8 }}>
  <button className="btn" onClick={importPlayersFromCsv}>Import Players</button>
  <button className="btn" onClick={replacePlayersFromCsv}>Replace Undrafted Players</button>

  <button className="btn btn-danger"
    onClick={resetDraft}
    style={{ border: '1px solid #c00' }}
    title="Deletes all auctions and clears drafted players"
  >
    Reset Draft (Admin)
  </button>
</div>
</section>
  </div>
</details>
)}
  </main>
  </>
  )
}