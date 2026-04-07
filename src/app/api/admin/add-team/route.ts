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

    const draftId = String(body?.draft_id ?? '').trim()
    const name = String(body?.name ?? '')
    const joinCode = String(body?.join_code ?? '')
    const budgetRemaining = Number(body?.budget_remaining)
    const rosterSpotsTotal = Number(body?.roster_spots_total)
    const rosterSpotsRemaining = Number(body?.roster_spots_remaining)
    const reason = String(body?.reason ?? '').trim()

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_add_team', {
      p_draft_id: draftId,
      p_name: name,
      p_join_code: joinCode,
      p_budget_remaining: budgetRemaining,
      p_roster_spots_total: rosterSpotsTotal,
      p_roster_spots_remaining: rosterSpotsRemaining,
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

    if (status !== 'TEAM_ADDED') {
      const messageByStatus: Record<string, string> = {
        DRAFT_NOT_FOUND: 'Draft not found.',
        INVALID_NAME: 'Team name is required.',
        INVALID_JOIN_CODE: 'Join code is required.',
        INVALID_BUDGET: 'Budget remaining must be 0 or greater.',
        INVALID_ROSTER_TOTAL: 'Roster spots total must be 0 or greater.',
        INVALID_ROSTER_REMAINING: 'Roster spots remaining must be 0 or greater.',
        ROSTER_REMAINING_EXCEEDS_TOTAL: 'Roster spots remaining cannot exceed total roster spots.',
        DUPLICATE_TEAM_NAME: 'Another team already has that name in this draft.',
        DUPLICATE_JOIN_CODE: 'Another team already has that join code in this draft.',
      }

      const httpByStatus: Record<string, number> = {
        DRAFT_NOT_FOUND: 404,
        INVALID_NAME: 400,
        INVALID_JOIN_CODE: 400,
        INVALID_BUDGET: 400,
        INVALID_ROSTER_TOTAL: 400,
        INVALID_ROSTER_REMAINING: 400,
        ROSTER_REMAINING_EXCEEDS_TOTAL: 400,
        DUPLICATE_TEAM_NAME: 400,
        DUPLICATE_JOIN_CODE: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Add team failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: row?.draft_id ?? draftId,
      event_type: 'ADMIN_ADD_TEAM',
      payload: {
        team_id: row?.team_id ?? null,
        reason: reason || null,
        name: row?.name ?? null,
        join_code: row?.join_code ?? null,
        budget_remaining: row?.budget_remaining ?? null,
        roster_spots_total: row?.roster_spots_total ?? null,
        roster_spots_remaining: row?.roster_spots_remaining ?? null,
      },
    })

    return NextResponse.json({
      ok: true,
      status,
      team_id: row?.team_id ?? null,
      draft_id: row?.draft_id ?? draftId,
      name: row?.name ?? null,
      join_code: row?.join_code ?? null,
      budget_remaining: row?.budget_remaining ?? null,
      roster_spots_total: row?.roster_spots_total ?? null,
      roster_spots_remaining: row?.roster_spots_remaining ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}