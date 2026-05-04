import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const draftId = String(body?.draft_id ?? '').trim()
    const teamCode = String(body?.team_code ?? '').trim()
    const playerId = String(body?.player_id ?? '').trim()

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    if (!teamCode) {
      return NextResponse.json({ error: 'Missing team_code.' }, { status: 401 })
    }

    if (!playerId) {
      return NextResponse.json({ error: 'Missing player_id.' }, { status: 400 })
    }

    const teamRes = await supabaseAdmin
      .from('teams')
      .select('id,draft_id,name')
      .eq('draft_id', draftId)
      .eq('join_code', teamCode)
      .maybeSingle()

    if (teamRes.error) {
      return NextResponse.json({ error: teamRes.error.message }, { status: 500 })
    }

    if (!teamRes.data) {
      return NextResponse.json({ error: 'Invalid team code.' }, { status: 401 })
    }

    const rpcRes = await supabaseAdmin.rpc('team_add_to_nomination_queue', {
      p_draft_id: draftId,
      p_team_id: teamRes.data.id,
      p_player_id: playerId,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    const status = String(row?.status ?? 'UNKNOWN')

    if (status !== 'ADDED') {
      const messageByStatus: Record<string, string> = {
        MISSING_DRAFT_ID: 'Missing draft_id.',
        MISSING_TEAM_ID: 'Missing team_id.',
        MISSING_PLAYER_ID: 'Missing player_id.',
        TEAM_NOT_FOUND: 'Team not found.',
        TEAM_WRONG_DRAFT: 'Team does not belong to this draft.',
        PLAYER_NOT_FOUND: 'Player not found.',
        PLAYER_WRONG_DRAFT: 'Player does not belong to this draft.',
        PLAYER_ALREADY_DRAFTED: 'Player is already drafted.',
        OPEN_AUCTION_EXISTS: 'An open auction already exists for this player.',
        ALREADY_IN_QUEUE: 'That player is already in your queue.',
      }

      const httpByStatus: Record<string, number> = {
        MISSING_DRAFT_ID: 400,
        MISSING_TEAM_ID: 400,
        MISSING_PLAYER_ID: 400,
        TEAM_NOT_FOUND: 404,
        TEAM_WRONG_DRAFT: 400,
        PLAYER_NOT_FOUND: 404,
        PLAYER_WRONG_DRAFT: 400,
        PLAYER_ALREADY_DRAFTED: 400,
        OPEN_AUCTION_EXISTS: 400,
        ALREADY_IN_QUEUE: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Add to queue failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'QUEUE_ADD',
      payload: {
        queue_id: row?.queue_id ?? null,
        team_id: teamRes.data.id,
        player_id: playerId,
        queue_position: row?.queue_position ?? null,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      queue_id: row?.queue_id ?? null,
      queue_position: row?.queue_position ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}