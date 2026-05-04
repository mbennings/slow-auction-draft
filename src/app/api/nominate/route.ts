import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

function isAdmin(req: Request) {
  const adminCode = req.headers.get('x-admin-code') ?? ''
  return adminCode && adminCode === (process.env.ADMIN_CODE ?? '')
}

export async function POST(req: Request) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }

    const body = await req.json()

    const draftId = String(body?.draft_id ?? '')
    const playerId = String(body?.player_id ?? '')

    if (!draftId) return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    if (!playerId) return NextResponse.json({ error: 'Missing player_id.' }, { status: 400 })

        const rpcRes = await supabaseAdmin.rpc('admin_nominate_player', {
      p_draft_id: draftId,
      p_player_id: playerId,
      p_nominated_by_team_id: null,
    })

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    const row =
      Array.isArray(rpcRes.data) && rpcRes.data.length > 0
        ? rpcRes.data[0]
        : null

    const status = String(row?.status ?? 'UNKNOWN')

    if (status !== 'NOMINATED') {
      const messageByStatus: Record<string, string> = {
        MISSING_DRAFT_ID: 'Missing draft_id.',
        MISSING_PLAYER_ID: 'Missing player_id.',
        PLAYER_NOT_FOUND: 'Player not found.',
        PLAYER_WRONG_DRAFT: 'Player does not belong to this draft.',
        PLAYER_ALREADY_DRAFTED: 'Player is already drafted.',
        OPEN_AUCTION_EXISTS: 'An open auction already exists for this player.',
        INVALID_NOMINATION_TIMER: 'Invalid nomination timer setting.',
      }

      const httpByStatus: Record<string, number> = {
        MISSING_DRAFT_ID: 400,
        MISSING_PLAYER_ID: 400,
        PLAYER_NOT_FOUND: 404,
        PLAYER_WRONG_DRAFT: 400,
        PLAYER_ALREADY_DRAFTED: 400,
        OPEN_AUCTION_EXISTS: 400,
        INVALID_NOMINATION_TIMER: 400,
      }

      return NextResponse.json(
        {
          error: messageByStatus[status] ?? `Nomination failed: ${status}`,
          status,
        },
        { status: httpByStatus[status] ?? 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      auction_id: row?.auction_id ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}