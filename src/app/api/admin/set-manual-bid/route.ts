import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const adminCode = req.headers.get('x-admin-code') ?? ''
    const expectedAdminCode = process.env.ADMIN_CODE ?? ''

    if (!expectedAdminCode || adminCode !== expectedAdminCode) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }

    const body = await req.json()

    const auctionId = String(body?.auction_id ?? '').trim()
    const teamId = String(body?.team_id ?? '').trim()
    const bidAmount = Number(body?.bid_amount ?? 0)
    const reason = String(body?.reason ?? '').trim()

    if (!auctionId) {
      return NextResponse.json({ error: 'Missing auction_id.' }, { status: 400 })
    }

    if (!teamId) {
      return NextResponse.json({ error: 'Missing team_id.' }, { status: 400 })
    }

    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return NextResponse.json({ error: 'Invalid bid_amount.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_set_manual_bid', {
      p_auction_id: auctionId,
      p_team_id: teamId,
      p_bid_amount: bidAmount,
      p_reason: reason || null,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    const status = String(row?.status ?? 'UNKNOWN')

    if (status !== 'BID_SET') {
      const messageByStatus: Record<string, string> = {
        INVALID_BID_AMOUNT: 'Invalid bid amount.',
        AUCTION_NOT_FOUND: 'Auction not found.',
        AUCTION_CLOSED: 'Auction is already closed.',
        TEAM_NOT_FOUND: 'Team not found for this draft.',
        NO_ROSTER_SPOTS: 'That team has no roster spots remaining.',
      }

      const httpByStatus: Record<string, number> = {
        INVALID_BID_AMOUNT: 400,
        AUCTION_NOT_FOUND: 404,
        AUCTION_CLOSED: 400,
        TEAM_NOT_FOUND: 400,
        NO_ROSTER_SPOTS: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Set manual bid failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: row?.draft_id ?? null,
      event_type: 'ADMIN_SET_MANUAL_BID',
      payload: {
        auction_id: row?.auction_id ?? auctionId,
        team_id: teamId,
        bid_amount: bidAmount,
        reason: reason || null,
        high_bid: row?.high_bid ?? 0,
        high_team_id: row?.high_team_id ?? null,
        ends_at: row?.ends_at ?? null,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      auction_id: row?.auction_id ?? auctionId,
      draft_id: row?.draft_id ?? null,
      high_bid: row?.high_bid ?? 0,
      high_team_id: row?.high_team_id ?? null,
      ends_at: row?.ends_at ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}