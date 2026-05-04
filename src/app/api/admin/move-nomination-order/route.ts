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
    const teamId = String(body?.team_id ?? '').trim()
    const direction = String(body?.direction ?? '').trim().toLowerCase()

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    if (!teamId) {
      return NextResponse.json({ error: 'Missing team_id.' }, { status: 400 })
    }

    if (direction !== 'up' && direction !== 'down') {
      return NextResponse.json({ error: 'Invalid direction.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_move_nomination_order_team', {
      p_draft_id: draftId,
      p_team_id: teamId,
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
        MISSING_DRAFT_ID: 'Missing draft_id.',
        MISSING_TEAM_ID: 'Missing team_id.',
        INVALID_DIRECTION: 'Invalid direction.',
        TEAM_NOT_FOUND_IN_ORDER: 'Team not found in nomination order.',
      }

      const httpByStatus: Record<string, number> = {
        MISSING_DRAFT_ID: 400,
        MISSING_TEAM_ID: 400,
        INVALID_DIRECTION: 400,
        TEAM_NOT_FOUND_IN_ORDER: 404,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Move nomination order failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'ADMIN_MOVE_NOMINATION_ORDER',
      payload: {
        team_id: teamId,
        direction,
        old_sort_order: row?.old_sort_order ?? null,
        new_sort_order: row?.new_sort_order ?? null,
        status,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      old_sort_order: row?.old_sort_order ?? null,
      new_sort_order: row?.new_sort_order ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}