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
  nominated_by_team_id: string | null
  high_bid: number
  high_team_id: string | null
  ends_at: string
  last_bid_at: string | null
  closed_at: string | null
  paused: boolean
}

type DraftSettings = {
  draft_id: string
  nomination_hours?: number | null
  bid_hours?: number | null
  nomination_seconds?: number | null
  bid_seconds?: number | null
  proxy_bidding_enabled?: boolean | null

  quiet_hours_enabled?: boolean | null
  quiet_start_minute?: number | null
  quiet_end_minute?: number | null
  quiet_timezone?: string | null
}

const DRAFT_ID = process.env.NEXT_PUBLIC_DRAFT_ID ?? ''

const PRIMARY_POSITIONS = new Set([
  'C','1B','2B','SS','3B','RF','CF','LF',
  'SP','SP/RP','RP','CP',
])

const SECONDARY_POSITIONS = new Set([
  'C','1B','2B','SS','3B','RF','CF','LF',
  'IF','OF','IF/OF','1B/OF',
  // If you ever want pitchers to have secondary roles too, add them here later.
])

function normPos(s: unknown) {
  return String(s ?? '').trim().toUpperCase()
}

function getRatingsSummary(p: Player | null) {
  if (!p) return '—'

  const primary = String(p.metadata?.position_primary ?? '').toUpperCase()
  const secondary = String(p.metadata?.position_secondary ?? '').toUpperCase()
  const isPitcher = ['SP', 'SP/RP', 'RP', 'CP'].includes(primary)

  const trait1 = String(p.metadata?.trait_1 ?? '').trim()
  const trait2 = String(p.metadata?.trait_2 ?? '').trim()
  const batHand = String(p.metadata?.bat_hand ?? '').trim()
  const throwHand = String(p.metadata?.throw_hand ?? '').trim()
  const age = p.metadata?.age ?? '—'

  if (isPitcher) {
    const arsenal = String(p.metadata?.arsenal ?? '').trim()
    const vel = p.metadata?.vel ?? '—'
    const jnk = p.metadata?.jnk ?? '—'
    const acc = p.metadata?.acc ?? '—'

    const parts = [
      primary || '—',
      arsenal || '—',
      `V-${vel}`,
      `J-${jnk}`,
      `A-${acc}`,
      `T1-${trait1 || '—'}`,
      `T2-${trait2 || '—'}`,
      throwHand || '—',
      String(age),
    ]

    return parts.join(' | ')
  }

  const pow = p.metadata?.pow ?? '—'
  const con = p.metadata?.con ?? '—'
  const spd = p.metadata?.spd ?? '—'
  const fld = p.metadata?.fld ?? '—'
  const arm = p.metadata?.arm ?? '—'

  const parts = [
    primary || '—',
    secondary || '—',
    `P-${pow}`,
    `C-${con}`,
    `S-${spd}`,
    `F-${fld}`,
    `A-${arm}`,
    `T1-${trait1 || '—'}`,
    `T2-${trait2 || '—'}`,
    batHand || '—',
    String(age),
  ]

  return parts.join(' | ')
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
  const [playerSortKey, setPlayerSortKey] = useState<
  'name' | 'primary' | 'secondary' | 'pow' | 'con' | 'spd' | 'fld' | 'arm' | 'vel' | 'jnk' | 'acc' | 'trait1' | 'trait2' | 'hand' | 'age'
>('name')
const [playerSortDir, setPlayerSortDir] = useState<'asc' | 'desc'>('asc')

  const [positionFilter, setPositionFilter] = useState('ALL')

  const [bidAmountText, setBidAmountText] = useState<string>('1')
  const [myProxyMax, setMyProxyMax] = useState<number | null>(null)
const [myProxyStatus, setMyProxyStatus] = useState<'WINNING' | 'OUTBID' | null>(null)
const [myActiveProxyBids, setMyActiveProxyBids] = useState<
  Array<{
    auction_id: string
    player_id: string
    player_name: string
    pos: string
    my_max_bid: number
    current_high_bid: number
    current_high_team_id: string | null
    status: 'WINNING' | 'OUTBID'
    needed_to_lead: number | null
    ends_at: string
  }>
>([])
  const [error, setError] = useState<string>('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const [nowTick, setNowTick] = useState(Date.now())

  const [teamCode, setTeamCode] = useState('')
const [lockedTeamId, setLockedTeamId] = useState<string>('')

  const [settings, setSettings] = useState<DraftSettings | null>(null)
  useEffect(() => {
  async function loadMyProxyStatus() {
    if (!settings?.proxy_bidding_enabled) {
      setMyProxyMax(null)
      setMyProxyStatus(null)
      return
    }

    if (!selectedAuctionId || !selectedTeamId) {
      setMyProxyMax(null)
      setMyProxyStatus(null)
      return
    }

    const { data: proxyRow } = await supabase
      .from('auction_proxy_bids')
      .select('max_bid')
      .eq('auction_id', selectedAuctionId)
      .eq('team_id', selectedTeamId)
      .maybeSingle()

    const max = proxyRow?.max_bid ?? null
    setMyProxyMax(max)

    const auction = auctions.find((a) => a.id === selectedAuctionId)

    if (auction && max != null) {
      if (auction.high_team_id === selectedTeamId) {
        setMyProxyStatus('WINNING')
      } else {
        setMyProxyStatus('OUTBID')
      }
    } else {
      setMyProxyStatus(null)
    }
  }

  loadMyProxyStatus()
}, [selectedAuctionId, selectedTeamId, settings?.proxy_bidding_enabled, auctions])
useEffect(() => {
  async function loadMyActiveProxyBids() {
    if (!settings?.proxy_bidding_enabled) {
      setMyActiveProxyBids([])
      return
    }

    if (!selectedTeamId || showAdmin) {
      setMyActiveProxyBids([])
      return
    }

    const { data: proxyRows, error } = await supabase
      .from('auction_proxy_bids')
      .select('auction_id, team_id, max_bid')
      .eq('team_id', selectedTeamId)

    if (error || !proxyRows) {
      setMyActiveProxyBids([])
      return
    }

    const rows = proxyRows
      .map((row) => {
        const auction = auctions.find((a) => a.id === row.auction_id && !a.closed_at)
        if (!auction) return null

        const player = players.find((p) => p.id === auction.player_id)
        const pos1 = player?.metadata?.position_primary ?? ''
        const pos2 = player?.metadata?.position_secondary ?? ''
        const pos = pos2 ? `${pos1}, ${pos2}` : pos1

        return {
  auction_id: auction.id,
  player_id: auction.player_id,
  player_name: player?.name ?? '(missing player)',
  pos,
  my_max_bid: Number(row.max_bid ?? 0),
  current_high_bid: Number(auction.high_bid ?? 0),
  current_high_team_id: auction.high_team_id ?? null,
  status: auction.high_team_id === selectedTeamId ? 'WINNING' as const : 'OUTBID' as const,
  needed_to_lead:
    auction.high_team_id === selectedTeamId
      ? null
      : Number(auction.high_bid ?? 0) + 1,
  ends_at: auction.ends_at,
}
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.player_name.localeCompare(b.player_name))

    setMyActiveProxyBids(rows)
  }

  loadMyActiveProxyBids()
}, [selectedTeamId, settings?.proxy_bidding_enabled, auctions, players, showAdmin])
  const [adminNominationSeconds, setAdminNominationSeconds] = useState<number>(12 * 3600)
const [adminBidSeconds, setAdminBidSeconds] = useState<number>(12 * 3600)
const [quietEnabled, setQuietEnabled] = useState<boolean>(false)
const [proxyBiddingEnabled, setProxyBiddingEnabled] = useState<boolean>(false)
const [quietStartTime, setQuietStartTime] = useState<string>('23:00')
const [quietEndTime, setQuietEndTime] = useState<string>('10:00')

  useEffect(() => {
  const t = setInterval(() => setNowTick(Date.now()), 1000)
  return () => clearInterval(t)
}, [])

useEffect(() => {
  const saved = localStorage.getItem('draft_theme')
  const nextTheme = saved === 'dark' ? 'dark' : 'light'
  setTheme(nextTheme)
  document.documentElement.setAttribute('data-theme', nextTheme)
}, [])

useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('draft_theme', theme)
}, [theme])

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

  setAdminNominationSeconds(
    settings.nomination_seconds ?? (settings.nomination_hours ?? 12) * 3600
  )

  setAdminBidSeconds(
    settings.bid_seconds ?? (settings.bid_hours ?? 12) * 3600
  )

  const enabled = !!settings.quiet_hours_enabled
  setQuietEnabled(enabled)

  const startMin = Number(settings.quiet_start_minute ?? 1380)
  const endMin = Number(settings.quiet_end_minute ?? 600)

  const toHHMM = (m: number) => {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    return `${hh}:${mm}`
  }

  setQuietStartTime(toHHMM(startMin))
  setQuietEndTime(toHHMM(endMin))

  setProxyBiddingEnabled(!!settings.proxy_bidding_enabled)
}, [settings])

  const [teamsCsv, setTeamsCsv] = useState(
  'name,budget,spots,code\nTeam A,200,23,ABC123\nTeam B,200,23,DEF456'
)
const [playersCsv, setPlayersCsv] = useState(
  'name,primary,secondary\nJohn Doe,SS,2B\nJane Doe,1B,\nJoe Smith,RF,OF\nJim Jones,C,1B/OF'
)
  function playerCanPlayPosition(p: Player, targetPos: string) {
  const t = (targetPos ?? '').toUpperCase()
  if (t === 'ALL') return true

  const primary = String(p.metadata?.position_primary ?? '').toUpperCase()
  const secondary = String(p.metadata?.position_secondary ?? '').toUpperCase()

  const pitcherRoles = ['SP', 'SP/RP', 'RP', 'CP']
  const infieldPositions = ['1B', '2B', 'SS', '3B']
  const outfieldPositions = ['LF', 'CF', 'RF']

  const isPitcher = pitcherRoles.includes(primary)
  const isHitter = !isPitcher

  const playablePositions = new Set<string>()

  if (primary) playablePositions.add(primary)
  if (secondary) playablePositions.add(secondary)

  // Expand grouped secondaries
  if (secondary === 'IF') {
    ;['1B', '2B', 'SS', '3B'].forEach((pos) => playablePositions.add(pos))
  }

  if (secondary === 'OF') {
    ;['LF', 'CF', 'RF'].forEach((pos) => playablePositions.add(pos))
  }

  if (secondary === 'IF/OF') {
    ;['1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'].forEach((pos) => playablePositions.add(pos))
  }

  if (secondary === '1B/OF') {
    ;['1B', 'LF', 'CF', 'RF'].forEach((pos) => playablePositions.add(pos))
  }

  // Broad player-type filters
  if (t === 'PITCHER') return isPitcher
  if (t === 'HITTER') return isHitter

  // Broad positional filters
  if (t === 'IF') {
    return Array.from(playablePositions).some((pos) => infieldPositions.includes(pos))
  }

  if (t === 'OF') {
    return Array.from(playablePositions).some((pos) => outfieldPositions.includes(pos))
  }

  // Direct position / role match
  return playablePositions.has(t)
}
const myProxyDashboardSummary = useMemo(() => {
  if (!lockedTeamId || showAdmin) {
    return {
      budgetRemaining: 0,
      committedMaxBids: 0,
      availableToSpendNow: 0,
    }
  }

  const team = teams.find((t) => t.id === lockedTeamId)
  const budgetRemaining = Number(team?.budget_remaining ?? 0)

  const committedMaxBids = myActiveProxyBids.reduce(
  (sum, row) =>
    row.status === 'WINNING'
      ? sum + Number(row.my_max_bid ?? 0)
      : sum,
  0
)

  const availableToSpendNow = Math.max(0, budgetRemaining - committedMaxBids)

  return {
    budgetRemaining,
    committedMaxBids,
    availableToSpendNow,
  }
}, [lockedTeamId, showAdmin, teams, myActiveProxyBids])
const myDraftedPlayers = useMemo(() => {
  if (!lockedTeamId || showAdmin) return []

  return players
    .filter((p) => p.drafted_by_team_id === lockedTeamId)
    .slice()
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map((p) => {
      const pos1 = String(p.metadata?.position_primary ?? '')
      const pos2 = String(p.metadata?.position_secondary ?? '')
      const pos = pos2 ? `${pos1}, ${pos2}` : pos1

      return {
        player_id: p.id,
        player_name: p.name ?? '',
        pos,
        winning_bid: p.winning_bid ?? null,
      }
    })
}, [players, lockedTeamId, showAdmin])
const draftedExportRows = useMemo(() => {
  const teamNameById = new Map(teams.map(t => [t.id, t.name]))

  return players
    .filter(p => !!p.drafted_by_team_id)
    .slice()
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map(p => {
  const primary = String(p.metadata?.position_primary ?? '')
  const secondary = String(p.metadata?.position_secondary ?? '')
  const pos = secondary ? `${primary}, ${secondary}` : primary

  const teamName = p.drafted_by_team_id
    ? (teamNameById.get(p.drafted_by_team_id) ?? 'Unknown')
    : ''

  const bid = p.winning_bid ?? ''

  return {
    player_name: p.name ?? '',
    pos,
    team_drafted_by: teamName,
    winning_bid: bid,
  }
})
}, [players, teams])

 const filteredUndraftedPlayers = useMemo(() => {
  const undrafted = players.filter((p) => !p.drafted_by_team_id)

  const searched = undrafted.filter((p) => {
    const name = String(p.name ?? '').toLowerCase()
    const primary = String(p.metadata?.position_primary ?? '').toUpperCase()
    const secondary = String(p.metadata?.position_secondary ?? '').toUpperCase()
    const arsenal = String(p.metadata?.arsenal ?? '').toUpperCase()
    const trait1 = String(p.metadata?.trait_1 ?? '').toLowerCase()
    const trait2 = String(p.metadata?.trait_2 ?? '').toLowerCase()
    const hand = String(p.metadata?.bat_hand ?? p.metadata?.throw_hand ?? '').toLowerCase()
    const search = playerSearch.trim().toLowerCase()

    const matchesSearch =
      !search ||
      name.includes(search) ||
      primary.toLowerCase().includes(search) ||
      secondary.toLowerCase().includes(search) ||
      arsenal.toLowerCase().includes(search) ||
      trait1.includes(search) ||
      trait2.includes(search) ||
      hand.includes(search)

    const matchesPosition =
      positionFilter === 'ALL' || playerCanPlayPosition(p, positionFilter)

    return matchesSearch && matchesPosition
  })

  const getSortValue = (p: Player) => {
    const primary = String(p.metadata?.position_primary ?? '')
    const secondary = String(p.metadata?.position_secondary ?? p.metadata?.arsenal ?? '')
    const hand = String(p.metadata?.bat_hand ?? p.metadata?.throw_hand ?? '')
    const trait1 = String(p.metadata?.trait_1 ?? '')
    const trait2 = String(p.metadata?.trait_2 ?? '')

    switch (playerSortKey) {
      case 'name':
        return String(p.name ?? '').toLowerCase()
      case 'primary':
        return primary.toLowerCase()
      case 'secondary':
        return secondary.toLowerCase()
      case 'pow':
        return Number(p.metadata?.pow ?? -1)
      case 'con':
        return Number(p.metadata?.con ?? -1)
      case 'spd':
        return Number(p.metadata?.spd ?? -1)
      case 'fld':
        return Number(p.metadata?.fld ?? -1)
      case 'arm':
        return Number(p.metadata?.arm ?? -1)
      case 'vel':
        return Number(p.metadata?.vel ?? -1)
      case 'jnk':
        return Number(p.metadata?.jnk ?? -1)
      case 'acc':
        return Number(p.metadata?.acc ?? -1)
      case 'trait1':
        return trait1.toLowerCase()
      case 'trait2':
        return trait2.toLowerCase()
      case 'hand':
        return hand.toLowerCase()
      case 'age':
        return Number(p.metadata?.age ?? -1)
      default:
        return String(p.name ?? '').toLowerCase()
    }
  }

  return searched.slice().sort((a, b) => {
    const av = getSortValue(a)
    const bv = getSortValue(b)

    let cmp = 0
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else {
      cmp = String(av).localeCompare(String(bv))
    }

    return playerSortDir === 'asc' ? cmp : -cmp
  })
}, [players, playerSearch, positionFilter, playerSortKey, playerSortDir])

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
    .select('id,name,budget_remaining,roster_spots_total,roster_spots_remaining')
    .eq('draft_id', DRAFT_ID)
    .order('name'),

  supabase
    .from('players')
    .select('id,name,metadata,drafted_by_team_id,winning_bid')
    .eq('draft_id', DRAFT_ID)
    .order('name'),

  supabase
    .from('auctions')
    .select('id,draft_id,player_id,nominated_by_team_id,high_bid,high_team_id,ends_at,last_bid_at,closed_at,paused')
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
  .select('draft_id,nomination_hours,bid_hours,nomination_seconds,bid_seconds,quiet_hours_enabled,quiet_start_minute,quiet_end_minute,quiet_timezone,proxy_bidding_enabled')
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

  // Admin-only: require admin code (same pattern as players import)
  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  const res = await fetch('/api/import-teams', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({
      draft_id: DRAFT_ID,
      csv: teamsCsv,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return setError(data?.error ?? 'Import teams failed.')

  setError(`Imported ${data?.count ?? 0} teams.`)
  await loadAll()
}

async function joinTeamByCode() {
  setError('')
  const code = teamCode.trim()
  if (!code) {
    setError('Enter your team code.')
    return
  }
  if (!DRAFT_ID) {
    setError('Missing DRAFT_ID.')
    return
  }

  const res = await fetch('/api/join-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft_id: DRAFT_ID, code }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    setError(data?.error ?? 'Invalid team code.')
    return
  }

  const teamId = String(data?.team_id ?? '')
  if (!teamId) {
    setError('Join failed (missing team id).')
    return
  }

  setLockedTeamId(teamId)
  setSelectedTeamId(teamId)
  localStorage.setItem('locked_team_id', teamId)
  localStorage.setItem('locked_team_code', code) // keep this; /api/bid uses it
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

  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  const res = await fetch('/api/save-draft-settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({
  draft_id: DRAFT_ID,
  nomination_seconds: adminNominationSeconds,
  bid_seconds: adminBidSeconds,

  proxy_bidding_enabled: proxyBiddingEnabled,

  quiet_hours_enabled: quietEnabled,
  quiet_start_minute: (() => {
    const [h, m] = (quietStartTime || '23:00').split(':').map(Number)
    return (Number.isFinite(h) ? h : 23) * 60 + (Number.isFinite(m) ? m : 0)
  })(),
  quiet_end_minute: (() => {
    const [h, m] = (quietEndTime || '10:00').split(':').map(Number)
    return (Number.isFinite(h) ? h : 10) * 60 + (Number.isFinite(m) ? m : 0)
  })(),
  quiet_timezone: 'America/New_York',
}),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return setError(data?.error ?? 'Save settings failed.')

// Apply immediately so admin can unpause right away
await fetch('/api/quiet-hours-tick', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-code': adminCode,
  },
  body: JSON.stringify({ draft_id: DRAFT_ID }),
})

setError('Saved timer settings.')
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

  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  const ok = window.confirm(
    'Replace Teams will remove ALL current teams for this draft and load the teams from the CSV.\n\nRecommended: Run Reset Draft first.\n\nContinue?'
  )
  if (!ok) return

  const res = await fetch('/api/replace-teams', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({
      draft_id: DRAFT_ID,
      csv: teamsCsv,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return setError(data?.error ?? 'Replace teams failed.')

  setError(`Replaced teams: ${data?.count ?? 0}.`)
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
  setBidAmountText('1')
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
  if (!showAdmin) return setError('Admin only.')

  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  setError('')

  const res = await fetch('/api/import-players', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({
      draft_id: DRAFT_ID,
      csv: playersCsv,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) return setError(data?.error ?? 'Import players failed.')

  setError(`Imported ${data?.count ?? 0} players.`)
  await loadAll()
}
function getSuggestedBidForAuction(auctionId: string) {
  const auction = auctions.find((a) => a.id === auctionId)
  if (!auction) return 1

  const currentHighPlusOne = Number(auction.high_bid ?? 0) + 1

  if (!settings?.proxy_bidding_enabled) {
    return currentHighPlusOne
  }

  const myProxyRow = myActiveProxyBids.find((row) => row.auction_id === auctionId)
  if (myProxyRow) {
    return myProxyRow.my_max_bid + 1
  }

  return currentHighPlusOne
}
function selectAuctionAndPrefillBid(auctionId: string, suggestedBid: number | null) {
  setSelectedAuctionId(auctionId)

  if (suggestedBid != null && Number.isFinite(suggestedBid) && suggestedBid > 0) {
    setBidAmountText(String(suggestedBid))
    return
  }

  const auction = auctions.find((a) => a.id === auctionId)
  if (!auction) return

  const fallbackBid = Number(auction.high_bid ?? 0) + 1
  setBidAmountText(String(fallbackBid))
}

function togglePlayerSort(
  nextKey: 'name' | 'primary' | 'secondary' | 'pow' | 'con' | 'spd' | 'fld' | 'arm' | 'vel' | 'jnk' | 'acc' | 'trait1' | 'trait2' | 'hand' | 'age'
) {
  if (playerSortKey === nextKey) {
    setPlayerSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  } else {
    setPlayerSortKey(nextKey)
    setPlayerSortDir('asc')
  }
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

async function autoFinalizeExpiredAuctionsFromServer() {
  if (!DRAFT_ID) return

  const res = await fetch('/api/auto-finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft_id: DRAFT_ID }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Keep this quiet unless you want to see it
    // setError(data?.error ?? 'Auto-finalize failed.')
    return
  }

  if ((data?.finalized ?? 0) > 0) {
    await loadAll()
  }
}

async function replacePlayersFromCsv() {
  if (!showAdmin) return setError('Admin only.')

  const adminCode = localStorage.getItem('admin_code') ?? ''
  if (!adminCode) return setError('Missing admin code. Refresh /admin and enter the code again.')

  const ok = window.confirm('Replace Undrafted Players will remove all UNDRAFTED players and related open auctions, then import the new list. Continue?')
  if (!ok) return

  setError('Clearing undrafted players...')

  const clearRes = await fetch('/api/replace-undrafted-players', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-code': adminCode,
    },
    body: JSON.stringify({ draft_id: DRAFT_ID }),
  })

  const clearData = await clearRes.json().catch(() => ({}))
  if (!clearRes.ok) return setError(clearData?.error ?? 'Replace undrafted players failed.')

  setError('Importing players...')
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
  if (showAdmin) autoFinalizeExpiredAuctionsFromServer()
}, 5000)

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
setBidAmountText('1')
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
  const bidAmount = parseInt(bidAmountText, 10)
if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
  return setError('Enter a valid bid.')
}

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

// Users: require team code. Admin: bidding as a team is disabled.
let code = ''
if (!showAdmin) {
  code = localStorage.getItem('locked_team_code') ?? ''
  if (!code) return setError('Join your team first.')
} else {
  return setError('Admin bidding as a team is disabled. Use a team account to bid.')
}

const res = await fetch('/api/bid', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
  draft_id: DRAFT_ID,
  auction_id: selectedAuctionId,
  team_code: code,
  bid_amount: bidAmount, // ✅ number, not string
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

function csvEscape(v: any) {
  const s = String(v ?? '')
  // Escape quotes and wrap in quotes if needed
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function autoFinalizeExpiredAuctionsFromDb() {
  setError('') // optional; remove if you don't want this to clear errors

  console.log('[autoFinalize] tick', new Date().toISOString())

  if (!DRAFT_ID) return

  // 1) Fetch expired, still-open auctions directly from DB (no stale React state)
  const expiredRes = await supabase
    .from('auctions')
    .select('id')
    .eq('draft_id', DRAFT_ID)
    .is('closed_at', null)
    .eq('paused', false)
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

async function copyDraftedToClipboardTSV() {
  const header = ['Player Name', 'Primary Position', 'Secondary Position', 'Team Drafted By', 'Winning Bid']
  const lines = [
    header.join('\t'),
    ...draftedExportRows.map(r =>
      [r.player_name, r.pos, r.team_drafted_by, r.winning_bid].join('\t')
    ),
  ]
  const tsv = lines.join('\n')

  try {
    await navigator.clipboard.writeText(tsv)
    setError('Copied drafted players to clipboard (paste into Google Sheets).')
  } catch {
    // Fallback: download TSV if clipboard blocked
    downloadTextFile(`drafted-players-${DRAFT_ID}.tsv`, tsv, 'text/tab-separated-values')
    setError('Clipboard blocked by browser. Downloaded TSV instead.')
  }
}

function downloadDraftedCSV() {
  const header = ['Player Name', 'Pos', 'Team Drafted By', 'Winning Bid']
  const lines = [
    header.map(csvEscape).join(','),
    ...draftedExportRows.map(r =>
      [
        csvEscape(r.player_name),
        csvEscape(r.pos),
        csvEscape(r.team_drafted_by),
        csvEscape(r.winning_bid),
      ].join(',')
    ),
  ]
  const csv = lines.join('\n')
  downloadTextFile(`drafted-players-${DRAFT_ID}.csv`, csv, 'text/csv')
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

      <div className="header-meta" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
  <span>
    Pending: {auctions.length} • Teams: {teams.length} • Players: {players.length}
  </span>

  <button
    className="btn"
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    type="button"
  >
    {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
  </button>
</div>
    </div>
  </div>

  <main className="container">
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

<section className="draft-grid">

        <div className="card" style={{ gridColumn: '1 / -1' }}>
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
<option value="HITTER">Hitters</option>
<option value="PITCHER">Pitchers</option>
<option value="C">C</option>
<option value="IF">IF</option>
<option value="OF">OF</option>
<option value="1B">1B</option>
<option value="2B">2B</option>
<option value="SS">SS</option>
<option value="3B">3B</option>
<option value="LF">LF</option>
<option value="CF">CF</option>
<option value="RF">RF</option>
<option value="SP">SP</option>
<option value="SP/RP">SP/RP</option>
<option value="RP">RP</option>
<option value="CP">CP</option>
  </select>
</label>
<div className="table-scroll undrafted-table-scroll" style={{ marginTop: 8 }}>
  <table className="table">
    <thead>
      <tr>
        <th style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => togglePlayerSort('name')}>Name</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('primary')}>PPos/Role</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('secondary')}>SPos/Arsenal</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('pow')}>POW</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('con')}>CON</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('spd')}>SPD</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('fld')}>FLD</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('arm')}>ARM</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('vel')}>VEL</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('jnk')}>JNK</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('acc')}>ACC</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('trait1')}>Trait 1</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('trait2')}>Trait 2</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('hand')}>Hand</th>
        <th style={{ cursor: 'pointer' }} onClick={() => togglePlayerSort('age')}>Age</th>
      </tr>
    </thead>
    <tbody>
      {filteredUndraftedPlayers.map((p) => {
        const primary = String(p.metadata?.position_primary ?? '')
        const secondaryOrArsenal = String(
          p.metadata?.position_secondary ?? p.metadata?.arsenal ?? ''
        )
        const hand = String(p.metadata?.bat_hand ?? p.metadata?.throw_hand ?? '')

        return (
          <tr
            key={p.id}
            onClick={() => setSelectedPlayerId(p.id)}
            style={{
              cursor: 'pointer',
              background:
                p.id === selectedPlayerId
                  ? 'color-mix(in srgb, var(--card) 82%, var(--primary) 18%)'
                  : 'transparent',
            }}
          >
            <td className="td-strong">{p.name}</td>
            <td>{primary || '—'}</td>
            <td>{secondaryOrArsenal || '—'}</td>
            <td>{p.metadata?.pow ?? '—'}</td>
            <td>{p.metadata?.con ?? '—'}</td>
            <td>{p.metadata?.spd ?? '—'}</td>
            <td>{p.metadata?.fld ?? '—'}</td>
            <td>{p.metadata?.arm ?? '—'}</td>
            <td>{p.metadata?.vel ?? '—'}</td>
            <td>{p.metadata?.jnk ?? '—'}</td>
            <td>{p.metadata?.acc ?? '—'}</td>
            <td>{p.metadata?.trait_1 ?? '—'}</td>
            <td>{p.metadata?.trait_2 ?? '—'}</td>
            <td>{hand || '—'}</td>
            <td>{p.metadata?.age ?? '—'}</td>
          </tr>
        )
      })}
    </tbody>
  </table>
</div>

          {showAdmin && (
  <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={nominate}>
    Nominate
  </button>
)}
        </div>

        <div className="card bid-panel">
          <h2 className="section-title">Place a Bid</h2>
          {proxyBiddingEnabled && myProxyMax != null && (
  <div style={{ marginBottom: 12 }}>
    <div className="muted">Your Max Bid</div>
    <div style={{ fontWeight: 700 }}>${myProxyMax}</div>

    <div style={{ marginTop: 4 }}>
      {myProxyStatus === 'WINNING' && (
        <span style={{ color: 'var(--success)', fontWeight: 600 }}>
          Winning
        </span>
      )}
      {myProxyStatus === 'OUTBID' && (
        <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
          Outbid
        </span>
      )}
    </div>
  </div>
)}
          <div
  style={{
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginBottom: 16,
  }}
>
  <div>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      Selected Auction
    </div>
    <div style={{ fontWeight: 800, fontSize: 18 }}>
      {selectedAuctionPlayer ? selectedAuctionPlayer.name : 'None selected'}
    </div>
  </div>

  <div>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      Current High Bid
    </div>
    <div
      style={{
        fontWeight: 800,
        fontSize: 18,
        color: selectedAuction?.high_bid ? 'var(--primary)' : 'var(--text)',
      }}
    >
      ${selectedAuction?.high_bid ?? 0}
    </div>
  </div>

  <div>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      High Team
    </div>
    <div style={{ fontWeight: 800, fontSize: 18 }}>
      {selectedAuctionHighTeamName}
    </div>
  </div>

  <div>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      Ends
    </div>
    <div
      style={{
        fontWeight: 800,
        fontSize: 18,
        color:
          selectedAuction && new Date(selectedAuction.ends_at).getTime() <= nowTick
            ? 'var(--danger)'
            : 'var(--text)',
      }}
    >
      {selectedAuction
        ? (new Date(selectedAuction.ends_at).getTime() <= nowTick
          ? 'Ended'
          : formatRemaining(new Date(selectedAuction.ends_at).getTime() - nowTick))
        : '—'}
    </div>
  </div>
</div>

<div style={{ marginTop: 4, marginBottom: 8 }}>
  <div style={{ marginBottom: 6, fontWeight: 600 }}>
    {settings?.proxy_bidding_enabled ? 'Max Bid:' : 'Amount:'}
  </div>
  <input
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    value={bidAmountText}
    onChange={(e) => {
      const next = e.target.value.replace(/[^\d]/g, '')
      setBidAmountText(next)
    }}
    onFocus={(e) => {
      setTimeout(() => e.target.select(), 0)
    }}
    style={{ width: '100%', maxWidth: 220 }}
  />
</div>
          {settings?.proxy_bidding_enabled && (
  <div className="help" style={{ marginTop: 8 }}>
    Enter your maximum bid. The app will only raise the visible price as much as needed.
  </div>
)}
          <div style={{ marginTop: 12 }}>
            <button
  className="btn btn-primary"
style={{ minWidth: 120 }}
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
  <h2 className="section-title">Pending Auctions</h2>

  {auctions.length === 0 ? (
    <p>None</p>
  ) : (
    
    <>
  <div className="table-only">
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Player</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Ratings</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>High Bid</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>High Team</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Ends</th>
  {showAdmin && (
    <th style={{ borderBottom: '1px solid #ddd' }}>Actions</th>
  )}
</tr>
        </thead>

        <tbody>
          {auctions.map((a) => {
            const p = players.find((pp) => pp.id === a.player_id)
            const ratingsSummary = getRatingsSummary(p ?? null)

            const highTeamName = a.high_team_id
              ? (teams.find((t) => t.id === a.high_team_id)?.name ?? 'Unknown')
              : '—'

            const paused = !!a.paused
const ended = !paused && new Date(a.ends_at).getTime() <= nowTick

            return (
              <tr
                key={a.id}
                className={ended ? 'row-ended' : 'row-active'}
                onClick={() => selectAuctionAndPrefillBid(a.id, getSuggestedBidForAuction(a.id))}
                style={{
  cursor: 'pointer',
  background: a.id === selectedAuctionId
    ? 'color-mix(in srgb, var(--card) 82%, var(--primary) 18%)'
    : 'transparent',
}}
              >
                <td className="td-strong">{p?.name ?? '(missing player)'}</td>
<td style={{ fontSize: 12 }}>{ratingsSummary}</td>
<td className="td-right td-strong">{a.high_bid}</td>
<td className="td-strong">{highTeamName}</td>

                <td className="td-strong">
                  {paused ? (
  <span className="badge badge-ended">Paused</span>
) : ended ? (
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
    </div>
  </div>

  <div className="cards-only">
    {auctions.length === 0 ? (
      <p>None</p>
    ) : (
      <div className="mobile-cards">
        {auctions.map((a) => {
          const p = players.find((pp) => pp.id === a.player_id)
          const pos1 = p?.metadata?.position_primary ?? ''
          const pos2 = p?.metadata?.position_secondary ?? ''
          const pos = pos2 ? `${pos1}, ${pos2}` : pos1

          const highTeamName = a.high_team_id
            ? (teams.find((t) => t.id === a.high_team_id)?.name ?? 'Unknown')
            : '—'

          const ended = new Date(a.ends_at).getTime() <= nowTick

          return (
            <div
              key={a.id}
              className="mobile-card"
              onClick={() => selectAuctionAndPrefillBid(a.id, getSuggestedBidForAuction(a.id))}
              style={{
                cursor: 'pointer',
                borderColor: a.id === selectedAuctionId ? '#999' : '#ddd',
              }}
            >
              <div className="mobile-card-title">{p?.name ?? '(missing player)'}</div>

              <div className="mobile-card-row">
  <span className="mobile-card-label">Ratings</span>
  <span className="mobile-card-value" style={{ fontSize: 12 }}>
    {getRatingsSummary(p ?? null)}
  </span>
</div>

              <div className="mobile-card-row">
                <span className="mobile-card-label">High Bid</span>
                <span className="mobile-card-value">${a.high_bid ?? 0}</span>
              </div>

              <div className="mobile-card-row">
                <span className="mobile-card-label">High Team</span>
                <span className="mobile-card-value">{highTeamName}</span>
              </div>

              <div className="mobile-card-row">
                <span className="mobile-card-label">Ends</span>
                <span className="mobile-card-value">
                  {ended ? 'Ended' : formatRemaining(new Date(a.ends_at).getTime() - nowTick)}
                </span>
              </div>

              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                {new Date(a.ends_at).toLocaleString()}
              </div>

              {showAdmin && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      finalizeNow(a.id)
                    }}
                  >
                    Finalize
                  </button>

                  <button
                    className="btn btn-danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      forceFinalizeNow(a.id)
                    }}
                  >
                    Force Finalize
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )}
  </div>
</>
  )}
</section>

{!showAdmin && lockedTeamId && (
  <section className="card">
    <h2 className="section-title">Your Team Dashboard</h2>
    <div className="help" style={{ marginBottom: 12 }}>
  Team: <b>{teams.find((t) => t.id === lockedTeamId)?.name ?? 'Unknown'}</b>
</div>
    <div
  style={{
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    marginBottom: 16,
  }}
>
  <div className="card" style={{ padding: 12 }}>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      Budget Remaining
    </div>
    <div style={{ fontSize: 20, fontWeight: 800 }}>
      {myProxyDashboardSummary.budgetRemaining}
    </div>
  </div>

  <div className="card" style={{ padding: 12 }}>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      Committed Max Bids
    </div>
    <div style={{ fontSize: 20, fontWeight: 800 }}>
      {myProxyDashboardSummary.committedMaxBids}
    </div>
  </div>

  <div className="card" style={{ padding: 12 }}>
    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
      Available to Spend Now
    </div>
    <div
      style={{
        fontSize: 20,
        fontWeight: 800,
        color:
          myProxyDashboardSummary.availableToSpendNow > 0
            ? 'var(--success)'
            : 'var(--danger)',
      }}
    >
      {myProxyDashboardSummary.availableToSpendNow}
    </div>
  </div>
</div>

    {settings?.proxy_bidding_enabled && (
      <>
        <h3 style={{ margin: '0 0 10px' }}>Your Active Max Bids</h3>

        {myActiveProxyBids.length === 0 ? (
          <p className="muted" style={{ marginBottom: 16 }}>No active proxy bids.</p>
        ) : (
          <div className="table-scroll" style={{ marginBottom: 20 }}>
            <table className="table">
              <thead>
                <tr>
  <th style={{ borderBottom: '1px solid #ddd' }}>Player</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Pos</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Your Max</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Current High</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Needed to Lead</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Status</th>
  <th style={{ borderBottom: '1px solid #ddd' }}>Ends</th>
</tr>
              </thead>
              <tbody>
                {myActiveProxyBids.map((row) => (
                  <tr
  key={row.auction_id}
  onClick={() =>
    selectAuctionAndPrefillBid(
      row.auction_id,
      row.needed_to_lead ?? row.my_max_bid + 1
    )
  }
  style={{ cursor: 'pointer' }}
>
  <td className="td-strong">{row.player_name}</td>
  <td>{row.pos || '—'}</td>
  <td className="td-strong">{row.my_max_bid}</td>
  <td>{row.current_high_bid}</td>
  <td>{row.needed_to_lead ?? '—'}</td>
  <td>
    {row.status === 'WINNING' ? (
      <span className="badge badge-live">Winning</span>
    ) : (
      <span className="badge badge-ended">Outbid</span>
    )}
  </td>
  <td>{new Date(row.ends_at).toLocaleString()}</td>
</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}

    <h3 style={{ margin: '0 0 10px' }}>Your Drafted Players</h3>

    {myDraftedPlayers.length === 0 ? (
      <p className="muted">No drafted players yet.</p>
    ) : (
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ borderBottom: '1px solid #ddd' }}>Player</th>
              <th style={{ borderBottom: '1px solid #ddd' }}>Pos</th>
              <th style={{ borderBottom: '1px solid #ddd' }}>Winning Bid</th>
            </tr>
          </thead>
          <tbody>
            {myDraftedPlayers.map((row) => (
              <tr key={row.player_id}>
                <td className="td-strong">{row.player_name}</td>
                <td>{row.pos || '—'}</td>
                <td>{row.winning_bid ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
)}

<section className="card">
  <h2 className="section-title">Teams Summary</h2>

  <div className="table-scroll">
  <table className="table">
    <thead>
      <tr>
        <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Team</th>
        <th style={{ borderBottom: '1px solid #ddd' }}>Budget Remaining</th>
        <th style={{ borderBottom: '1px solid #ddd' }}>Committed (High Bids)</th>
        <th style={{ borderBottom: '1px solid #ddd' }}>Available Budget</th>
        <th style={{ borderBottom: '1px solid #ddd' }}>Roster Spots Left</th>
      </tr>
    </thead>
    <tbody>
      {teams.map((t) => {
        const committed = teamCommittedHighBids(t.id)
        const available = teamAvailableBudget(t)

        return (
          <tr
  key={t.id}
  style={{
    background:
      t.id === selectedTeamId
        ? 'color-mix(in srgb, var(--card) 82%, var(--primary) 18%)'
        : 'transparent',
  }}
>
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
</div>
</section>

      

      <section className="card">
        
  <h2 className="section-title">Drafted Players</h2>

  <div className="btn-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
    <button className="btn" onClick={copyDraftedToClipboardTSV} disabled={draftedExportRows.length === 0}>
      Copy (Google Sheets)
    </button>

    <button className="btn" onClick={downloadDraftedCSV} disabled={draftedExportRows.length === 0}>
      Download CSV
    </button>

    <div className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
      Rows: {draftedExportRows.length}
    </div>
  </div>

  {draftedExportRows.length === 0 ? (
    <p>None</p>
  ) : (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>Player</th>
            <th style={{ borderBottom: '1px solid #ddd' }}>Pos</th>
            <th style={{ borderBottom: '1px solid #ddd' }}>Team</th>
            <th style={{ borderBottom: '1px solid #ddd' }}>Winning Bid</th>
          </tr>
        </thead>
        <tbody>
          {draftedExportRows.map((r, idx) => (
            <tr key={`${r.player_name}-${idx}`}>
              <td className="td-strong">{r.player_name}</td>
              <td>{r.pos || '—'}</td>
              <td>{r.team_drafted_by || '—'}</td>
              <td className="td-right td-strong">{r.winning_bid === '' ? '—' : r.winning_bid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
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
    Nomination timer
  </div>

  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <input
      type="number"
      min={0}
      value={Math.floor(adminNominationSeconds / 60)}
      onChange={(e) => {
        const minutes = parseInt(e.target.value || '0', 10)
        setAdminNominationSeconds(
          minutes * 60 + (adminNominationSeconds % 60)
        )
      }}
      style={{ width: 80 }}
    />
    <span>min</span>

    <input
      type="number"
      min={0}
      max={59}
      value={adminNominationSeconds % 60}
      onChange={(e) => {
        const seconds = parseInt(e.target.value || '0', 10)
        setAdminNominationSeconds(
          Math.floor(adminNominationSeconds / 60) * 60 + seconds
        )
      }}
      style={{ width: 80 }}
    />
    <span>sec</span>
  </div>
</label>

    <label>
  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
    Bid timer extension
  </div>

  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <input
      type="number"
      min={0}
      value={Math.floor(adminBidSeconds / 60)}
      onChange={(e) => {
        const minutes = parseInt(e.target.value || '0', 10)
        setAdminBidSeconds(
          minutes * 60 + (adminBidSeconds % 60)
        )
      }}
      style={{ width: 80 }}
    />
    <span>min</span>

    <input
      type="number"
      min={0}
      max={59}
      value={adminBidSeconds % 60}
      onChange={(e) => {
        const seconds = parseInt(e.target.value || '0', 10)
        setAdminBidSeconds(
          Math.floor(adminBidSeconds / 60) * 60 + seconds
        )
      }}
      style={{ width: 80 }}
    />
    <span>sec</span>
  </div>
</label>
     </div>

  <hr style={{ margin: '16px 0' }} />

  <h3 style={{ margin: '0 0 8px' }}>Proxy Bidding</h3>
  <p className="help">
    When enabled, teams enter a hidden maximum bid. The app automatically bids only as much as needed to keep them in the lead.
  </p>

  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
    <input
      type="checkbox"
      checked={proxyBiddingEnabled}
      onChange={(e) => setProxyBiddingEnabled(e.target.checked)}
    />
    Enable proxy bidding
  </label>

  <hr style={{ margin: '16px 0' }} />

  <h3 style={{ margin: '0 0 8px' }}>Quiet Hours (pause auctions)</h3>
  <p className="help">
    During quiet hours, all active auctions pause and resume when quiet hours end.
    Times are in Eastern Time.
  </p>

  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
    <input
      type="checkbox"
      checked={quietEnabled}
      onChange={(e) => setQuietEnabled(e.target.checked)}
    />
    Enable quiet hours
  </label>

  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
    <label>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        Quiet start (ET)
      </div>
      <input
        type="time"
        value={quietStartTime}
        onChange={(e) => setQuietStartTime(e.target.value)}
        style={{ width: '100%' }}
      />
    </label>

    <label>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        Quiet end (ET)
      </div>
      <input
        type="time"
        value={quietEndTime}
        onChange={(e) => setQuietEndTime(e.target.value)}
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
  Paste a team list with 2 or 3 columns. Headers are optional.
  <br />
  Format: <b>name,budget,spots,code</b>
  <br />
  Examples:
  <br />
  <code>Team A,260,23,ABC123</code>
  <br />
  <code>Team B,260,23,EFG456</code>
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
    Paste a player list <b>name,primary,secondary</b>. spos is optional
    <br />
    Example:
    <br />
    <code>name,primary,secondary</code>
    <br />
    <code>Player One,SS,3B</code>
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