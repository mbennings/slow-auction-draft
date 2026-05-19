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

    const teamId = String(body?.team_id ?? '').trim()
    const name = String(body?.name ?? '')
    const joinCode = String(body?.join_code ?? '')
    const budgetRemaining = Number(body?.budget_remaining)
    const rosterSpotsTotal = Number(body?.roster_spots_total)
    const rosterSpotsRemaining = Number(body?.roster_spots_remaining)
    const hitterSpotsTotal = Number(body?.hitter_spots_total)
    const hitterSpotsRemaining = Number(body?.hitter_spots_remaining)
    const pitcherSpotsTotal = Number(body?.pitcher_spots_total)
    const pitcherSpotsRemaining = Number(body?.pitcher_spots_remaining)
    const reason = String(body?.reason ?? '').trim()

    if (!teamId) {
      return NextResponse.json({ error: 'Missing team_id.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('admin_update_team', {
      p_team_id: teamId,
      p_name: name,
      p_join_code: joinCode,
      p_budget_remaining: budgetRemaining,
      p_roster_spots_total: rosterSpotsTotal,
      p_roster_spots_remaining: rosterSpotsRemaining,
      p_reason: reason || null,
      p_hitter_spots_total: hitterSpotsTotal,
      p_hitter_spots_remaining: hitterSpotsRemaining,
      p_pitcher_spots_total: pitcherSpotsTotal,
      p_pitcher_spots_remaining: pitcherSpotsRemaining,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    const status = String(row?.status ?? 'UNKNOWN')

    if (status !== 'TEAM_UPDATED') {
      const messageByStatus: Record<string, string> = {
        TEAM_NOT_FOUND: 'Team not found.',
        INVALID_NAME: 'Team name is required.',
        INVALID_JOIN_CODE: 'Join code is required.',
        INVALID_BUDGET: 'Budget remaining must be 0 or greater.',
        INVALID_ROSTER_TOTAL: 'Roster spots total must be 0 or greater.',
        INVALID_ROSTER_REMAINING: 'Roster spots remaining must be 0 or greater.',
        ROSTER_REMAINING_EXCEEDS_TOTAL: 'Roster spots remaining cannot exceed total roster spots.',
        INVALID_HITTER_TOTAL: 'Hitter spots total must be 0 or greater.',
        INVALID_HITTER_REMAINING: 'Hitter spots remaining must be 0 or greater.',
        INVALID_PITCHER_TOTAL: 'Pitcher spots total must be 0 or greater.',
        INVALID_PITCHER_REMAINING: 'Pitcher spots remaining must be 0 or greater.',
        HITTER_REMAINING_EXCEEDS_TOTAL: 'Hitter spots remaining cannot exceed hitter spots total.',
        PITCHER_REMAINING_EXCEEDS_TOTAL: 'Pitcher spots remaining cannot exceed pitcher spots total.',
        DUPLICATE_TEAM_NAME: 'Another team already has that name in this draft.',
        DUPLICATE_JOIN_CODE: 'Another team already has that join code in this draft.',
      }

      const httpByStatus: Record<string, number> = {
        TEAM_NOT_FOUND: 404,
        INVALID_NAME: 400,
        INVALID_JOIN_CODE: 400,
        INVALID_BUDGET: 400,
        INVALID_ROSTER_TOTAL: 400,
        INVALID_ROSTER_REMAINING: 400,
        ROSTER_REMAINING_EXCEEDS_TOTAL: 400,
        INVALID_HITTER_TOTAL: 400,
        INVALID_HITTER_REMAINING: 400,
        INVALID_PITCHER_TOTAL: 400,
        INVALID_PITCHER_REMAINING: 400,
        HITTER_REMAINING_EXCEEDS_TOTAL: 400,
        PITCHER_REMAINING_EXCEEDS_TOTAL: 400,
        DUPLICATE_TEAM_NAME: 400,
        DUPLICATE_JOIN_CODE: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Update team failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: row?.draft_id ?? null,
      event_type: 'ADMIN_UPDATE_TEAM',
      payload: {
        team_id: row?.team_id ?? teamId,
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
      team_id: row?.team_id ?? teamId,
      draft_id: row?.draft_id ?? null,
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