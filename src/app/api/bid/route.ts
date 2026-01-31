import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const draftId = String(body?.draft_id ?? '')
    const auctionId = String(body?.auction_id ?? '')
    const teamCode = String(body?.team_code ?? '').trim()
    const bidAmount = Number(body?.bid_amount ?? 0)

    if (!draftId) return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    if (!auctionId) return NextResponse.json({ error: 'Missing auction_id.' }, { status: 400 })
    if (!teamCode) return NextResponse.json({ error: 'Missing team_code.' }, { status: 400 })
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return NextResponse.json({ error: 'Invalid bid_amount.' }, { status: 400 })
    }

    // 1) Resolve team from code
    const teamRes = await supabaseAdmin
      .from('teams')
      .select('id,name,budget_remaining,roster_spots_remaining,join_code')
      .eq('draft_id', draftId)
      .eq('join_code', teamCode)
      .maybeSingle()

    if (teamRes.error) return NextResponse.json({ error: teamRes.error.message }, { status: 500 })
    if (!teamRes.data) return NextResponse.json({ error: 'Invalid team code.' }, { status: 401 })

    const team = teamRes.data

    if ((team.roster_spots_remaining ?? 0) <= 0) {
      return NextResponse.json({ error: 'No roster spots remaining.' }, { status: 400 })
    }

    // 2) Load auction
    const auctionRes = await supabaseAdmin
      .from('auctions')
      .select('id,draft_id,player_id,high_bid,high_team_id,ends_at,closed_at')
      .eq('id', auctionId)
      .maybeSingle()

    if (auctionRes.error) return NextResponse.json({ error: auctionRes.error.message }, { status: 500 })
    if (!auctionRes.data) return NextResponse.json({ error: 'Auction not found.' }, { status: 404 })

    const auction = auctionRes.data

    if (auction.draft_id !== draftId) {
      return NextResponse.json({ error: 'Auction does not belong to this draft.' }, { status: 400 })
    }
    if (auction.closed_at) {
      return NextResponse.json({ error: 'Auction already closed.' }, { status: 400 })
    }

    // Allow bids even if technically ended (admin can finalize; auto-finalize will run soon),
    // but if you want to block: uncomment next lines
    // if (new Date() > new Date(auction.ends_at)) {
    //   return NextResponse.json({ error: 'Auction has ended.' }, { status: 400 })
    // }

    // 3) Min increment check
    const minInc = 1
    const requiredMin = (auction.high_bid ?? 0) + minInc
    if (bidAmount < requiredMin) {
      return NextResponse.json({ error: `Bid must be at least ${requiredMin}.` }, { status: 400 })
    }

    // 4) Compute committed high bids for this team on OTHER active auctions
    // committed = sum(high_bid) where this team is current high bidder and auction is open
    const committedRes = await supabaseAdmin
      .from('auctions')
      .select('high_bid,high_team_id,id', { count: 'exact' })
      .eq('draft_id', draftId)
      .is('closed_at', null)
      .eq('high_team_id', team.id)

    if (committedRes.error) return NextResponse.json({ error: committedRes.error.message }, { status: 500 })

    const committedRows = committedRes.data ?? []
    const committed = committedRows.reduce((sum: number, r: any) => sum + Number(r.high_bid ?? 0), 0)

    // credit: if this team is already the high bidder on THIS auction,
    // then their committed total already includes auction.high_bid.
    const credit = auction.high_team_id === team.id ? Number(auction.high_bid ?? 0) : 0

    const available = Math.max(0, Number(team.budget_remaining ?? 0) - (committed - credit))
    if (bidAmount > available) {
      return NextResponse.json({ error: `Bid exceeds available budget (${available}).` }, { status: 400 })
    }

    // 5) Apply bid timer rule:
    // ends_at becomes max(current ends_at, now + bid_hours)
    const settingsRes = await supabaseAdmin
  .from('draft_settings')
  .select('bid_seconds, bid_hours')
  .eq('draft_id', draftId)
  .maybeSingle()

if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 500 })

const bidSeconds =
  settingsRes.data?.bid_seconds != null
    ? Number(settingsRes.data.bid_seconds)
    : Number(settingsRes.data?.bid_hours ?? 12) * 3600

if (!Number.isFinite(bidSeconds) || bidSeconds < 0) {
  return NextResponse.json({ error: 'Invalid bid timer setting.' }, { status: 400 })
}

const now = Date.now()
const currentEndsMs = new Date(auction.ends_at).getTime()
const minEndsMs = now + bidSeconds * 1000
const newEndsMs = Math.max(currentEndsMs, minEndsMs)
const newEnds = new Date(newEndsMs).toISOString()

    // 6) Update auction
    const upRes = await supabaseAdmin
      .from('auctions')
      .update({
        high_bid: bidAmount,
        high_team_id: team.id,
        last_bid_at: new Date().toISOString(),
        ends_at: newEnds,
      })
      .eq('id', auctionId)

    if (upRes.error) return NextResponse.json({ error: upRes.error.message }, { status: 500 })

    // 7) Log event
    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'BID',
      payload: {
        auction_id: auctionId,
        team_id: team.id,
        amount: bidAmount,
        player_id: auction.player_id,
        ends_at: newEnds,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}