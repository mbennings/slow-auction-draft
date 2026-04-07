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
    const minutesRemaining = Number(body?.minutes_remaining)
    const reason = String(body?.reason ?? '').trim()

    if (!auctionId) {
      return NextResponse.json({ error: 'Missing auction_id.' }, { status: 400 })
    }

    if (!Number.isFinite(minutesRemaining) || minutesRemaining < 0) {
      return NextResponse.json({ error: 'Invalid minutes_remaining.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_set_auction_timer', {
      p_auction_id: auctionId,
      p_minutes_remaining: minutesRemaining,
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

    if (status !== 'TIMER_SET' && status !== 'TIMER_SET_WHILE_PAUSED') {
      const messageByStatus: Record<string, string> = {
        INVALID_MINUTES: 'Minutes remaining must be 0 or greater.',
        AUCTION_NOT_FOUND: 'Auction not found.',
        AUCTION_CLOSED: 'Auction is already closed.',
      }

      const httpByStatus: Record<string, number> = {
        INVALID_MINUTES: 400,
        AUCTION_NOT_FOUND: 404,
        AUCTION_CLOSED: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Set auction timer failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: row?.draft_id ?? null,
      event_type: 'ADMIN_SET_AUCTION_TIMER',
      payload: {
        auction_id: row?.auction_id ?? auctionId,
        reason: reason || null,
        minutes_remaining: minutesRemaining,
        status,
        ends_at: row?.ends_at ?? null,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      auction_id: row?.auction_id ?? auctionId,
      draft_id: row?.draft_id ?? null,
      ends_at: row?.ends_at ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}