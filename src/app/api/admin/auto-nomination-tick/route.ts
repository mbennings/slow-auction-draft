import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const adminCode = req.headers.get('x-admin-code') ?? ''
    const expected = process.env.ADMIN_CODE ?? ''

    if (!expected || adminCode !== expected) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const draftId = String(body?.draft_id ?? '').trim()

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('auto_nomination_tick', {
      p_draft_id: draftId,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    return NextResponse.json({
      ok: true,
      status: row?.status ?? 'UNKNOWN',
      team_id: row?.team_id ?? null,
      player_id: row?.player_id ?? null,
      auction_id: row?.auction_id ?? null,
      current_order_position: row?.current_order_position ?? null,
      next_order_position: row?.next_order_position ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}