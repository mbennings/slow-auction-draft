import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

function isAdmin(req: Request) {
  const adminCode = req.headers.get('x-admin-code') ?? ''
  return adminCode && adminCode === (process.env.ADMIN_CODE ?? '')
}

export async function POST(req: Request) {
  try {
    if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

    const body = await req.json()
    const draftId = String(body?.draft_id ?? '')
    if (!draftId) return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })

    // 1) Clear draft_state nomination (FK safety if still referenced anywhere)
    await supabaseAdmin
      .from('draft_state')
      .update({
        nominated_player_id: null,
        high_bid: 0,
        high_team_id: null,
        ends_at: null,
        last_bid_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('draft_id', draftId)

    // 2) Get undrafted player ids
    const undraftedRes = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('draft_id', draftId)
      .is('drafted_by_team_id', null)

    if (undraftedRes.error) return NextResponse.json({ error: undraftedRes.error.message }, { status: 500 })

    const undraftedIds = (undraftedRes.data ?? []).map((r: any) => r.id)

    if (undraftedIds.length > 0) {
      // 3) Delete auctions that reference these players (FK safety)
      const delAuctions = await supabaseAdmin
        .from('auctions')
        .delete()
        .eq('draft_id', draftId)
        .in('player_id', undraftedIds)

      if (delAuctions.error) return NextResponse.json({ error: delAuctions.error.message }, { status: 500 })

      // 4) Delete undrafted players
      const delPlayers = await supabaseAdmin
        .from('players')
        .delete()
        .eq('draft_id', draftId)
        .in('id', undraftedIds)

      if (delPlayers.error) return NextResponse.json({ error: delPlayers.error.message }, { status: 500 })
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'REPLACE_UNDRAFTED_PLAYERS_CLEAR',
      payload: { removed: undraftedIds.length },
    })

    return NextResponse.json({ ok: true, removed: undraftedIds.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}