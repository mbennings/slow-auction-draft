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
    const reason = String(body?.reason ?? '').trim()

    if (!auctionId) {
      return NextResponse.json({ error: 'Missing auction_id.' }, { status: 400 })
    }

    if (!teamId) {
      return NextResponse.json({ error: 'Missing team_id.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_remove_team_bid', {
      p_auction_id: auctionId,
      p_team_id: teamId,
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

    if (status !== 'BID_REMOVED') {
      const messageByStatus: Record<string, string> = {
        AUCTION_NOT_FOUND: 'Auction not found.',
        AUCTION_CLOSED: 'Auction is already closed.',
        TEAM_BID_NOT_FOUND: 'That team does not have a bid in this auction.',
      }

      const httpByStatus: Record<string, number> = {
        AUCTION_NOT_FOUND: 404,
        AUCTION_CLOSED: 400,
        TEAM_BID_NOT_FOUND: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Remove team bid failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: row?.draft_id ?? null,
      event_type: 'ADMIN_REMOVE_TEAM_BID',
      payload: {
        auction_id: row?.auction_id ?? auctionId,
        team_id: teamId,
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