import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const draftId = String(body?.draft_id ?? '')
    const auctionId = String(body?.auction_id ?? '')
    const teamCode = String(body?.team_code ?? '').trim()
    const bidAmount = Number(body?.bid_amount ?? 0)

    const rpcRes = await supabaseAdmin.rpc('place_bid_atomic', {
      p_draft_id: draftId,
      p_auction_id: auctionId,
      p_team_code: teamCode,
      p_bid_amount: bidAmount,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    const status = String(row?.result_status ?? 'UNKNOWN')

    if (status === 'BID_ACCEPTED' || status === 'PROXY_SAVED') {
  await supabaseAdmin.from('draft_events').insert({
    draft_id: draftId,
    event_type: 'BID',
    payload: {
      auction_id: row?.result_auction_id ?? auctionId,
      team_code: teamCode,
      amount: bidAmount,
      status,
      high_bid: row?.result_high_bid ?? null,
      high_team_id: row?.result_high_team_id ?? null,
      ends_at: row?.result_ends_at ?? null,
    },
  })

      return NextResponse.json({
  ok: true,
  status,
  high_bid: row?.result_high_bid ?? null,
  high_team_id: row?.result_high_team_id ?? null,
  ends_at: row?.result_ends_at ?? null,
})
    }

    const messageByStatus: Record<string, string> = {
      MISSING_DRAFT_ID: 'Missing draft_id.',
      MISSING_AUCTION_ID: 'Missing auction_id.',
      MISSING_TEAM_CODE: 'Missing team_code.',
      INVALID_BID_AMOUNT: 'Invalid bid_amount.',
      INVALID_TEAM_CODE: 'Invalid team code.',
      NO_ROSTER_SPOTS: 'No roster spots remaining.',
      AUCTION_NOT_FOUND: 'Auction not found.',
      AUCTION_WRONG_DRAFT: 'Auction does not belong to this draft.',
      AUCTION_CLOSED: 'Auction already closed.',
      AUCTION_PAUSED: 'Auction is paused during quiet hours.',
      AUCTION_ENDED: 'Auction has ended.',
      BID_TOO_LOW: 'Bid must be at least the current high bid plus 1.',
      BID_EXCEEDS_AVAILABLE: 'Bid exceeds available budget.',
      PROXY_MUST_INCREASE: 'Your proxy max must be higher than your existing proxy bid.',
    }

    const httpByStatus: Record<string, number> = {
      INVALID_TEAM_CODE: 401,
      AUCTION_NOT_FOUND: 404,
      AUCTION_CLOSED: 400,
      AUCTION_PAUSED: 400,
      AUCTION_ENDED: 400,
      BID_TOO_LOW: 400,
      BID_EXCEEDS_AVAILABLE: 400,
      NO_ROSTER_SPOTS: 400,
      PROXY_MUST_INCREASE: 400,
    }

    return NextResponse.json(
      {
        error: messageByStatus[status] ?? `Bid failed: ${status}`,
        status,
      },
      { status: httpByStatus[status] ?? 400 }
    )
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}