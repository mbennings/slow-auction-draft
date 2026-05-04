import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const draftId = String(body?.draft_id ?? '').trim()
    const teamCode = String(body?.team_code ?? '').trim()
    const queueId = String(body?.queue_id ?? '').trim()
    const direction = String(body?.direction ?? '').trim().toLowerCase()

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    if (!teamCode) {
      return NextResponse.json({ error: 'Missing team_code.' }, { status: 401 })
    }

    if (!queueId) {
      return NextResponse.json({ error: 'Missing queue_id.' }, { status: 400 })
    }

    if (direction !== 'up' && direction !== 'down') {
      return NextResponse.json({ error: 'Invalid direction.' }, { status: 400 })
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

    const rpcRes = await supabaseAdmin.rpc('team_move_nomination_queue_item', {
      p_queue_id: queueId,
      p_team_id: teamRes.data.id,
      p_direction: direction,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    const status = String(row?.status ?? 'UNKNOWN')

    if (status !== 'MOVED' && status !== 'NO_MOVE') {
      const messageByStatus: Record<string, string> = {
        MISSING_QUEUE_ID: 'Missing queue_id.',
        MISSING_TEAM_ID: 'Missing team_id.',
        INVALID_DIRECTION: 'Invalid direction.',
        QUEUE_ITEM_NOT_FOUND: 'Queue item not found.',
        QUEUE_ITEM_WRONG_TEAM: 'That queue item does not belong to your team.',
      }

      const httpByStatus: Record<string, number> = {
        MISSING_QUEUE_ID: 400,
        MISSING_TEAM_ID: 400,
        INVALID_DIRECTION: 400,
        QUEUE_ITEM_NOT_FOUND: 404,
        QUEUE_ITEM_WRONG_TEAM: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Move queue item failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'QUEUE_MOVE',
      payload: {
        queue_id: row?.queue_id ?? queueId,
        team_id: teamRes.data.id,
        direction,
        old_position: row?.old_position ?? null,
        new_position: row?.new_position ?? null,
        status,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      queue_id: row?.queue_id ?? queueId,
      old_position: row?.old_position ?? null,
      new_position: row?.new_position ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}