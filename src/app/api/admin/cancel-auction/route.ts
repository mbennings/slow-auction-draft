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
    const reason = String(body?.reason ?? '').trim()

    if (!auctionId) {
      return NextResponse.json({ error: 'Missing auction_id.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_cancel_auction', {
      p_auction_id: auctionId,
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

    if (status !== 'AUCTION_CANCELLED') {
      const messageByStatus: Record<string, string> = {
        AUCTION_NOT_FOUND: 'Auction not found.',
        AUCTION_ALREADY_CLOSED: 'Auction is already closed.',
      }

      const httpByStatus: Record<string, number> = {
        AUCTION_NOT_FOUND: 404,
        AUCTION_ALREADY_CLOSED: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Cancel auction failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: row?.draft_id ?? null,
      event_type: 'ADMIN_CANCEL_AUCTION',
      payload: {
        auction_id: row?.auction_id ?? auctionId,
        reason: reason || null,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      auction_id: row?.auction_id ?? auctionId,
      draft_id: row?.draft_id ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}