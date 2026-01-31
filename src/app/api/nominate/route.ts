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

    // 1) Ensure player exists and is undrafted
    const pRes = await supabaseAdmin
      .from('players')
      .select('id,draft_id,drafted_by_team_id')
      .eq('id', playerId)
      .maybeSingle()

    if (pRes.error) return NextResponse.json({ error: pRes.error.message }, { status: 500 })
    if (!pRes.data) return NextResponse.json({ error: 'Player not found.' }, { status: 404 })
    if (pRes.data.draft_id !== draftId) {
      return NextResponse.json({ error: 'Player does not belong to this draft.' }, { status: 400 })
    }
    if (pRes.data.drafted_by_team_id) {
      return NextResponse.json({ error: 'Player is already drafted.' }, { status: 400 })
    }

    // 2) Ensure there is no existing open auction for this player
    const existingRes = await supabaseAdmin
      .from('auctions')
      .select('id')
      .eq('draft_id', draftId)
      .eq('player_id', playerId)
      .is('closed_at', null)
      .maybeSingle()

    if (existingRes.error) return NextResponse.json({ error: existingRes.error.message }, { status: 500 })
    if (existingRes.data?.id) {
      return NextResponse.json({ error: 'An open auction already exists for this player.' }, { status: 400 })
    }

    // 3) Get nomination timer from settings (seconds-first)
const settingsRes = await supabaseAdmin
  .from('draft_settings')
  .select('nomination_seconds, nomination_hours')
  .eq('draft_id', draftId)
  .maybeSingle()

if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 500 })

const nominationSeconds =
  settingsRes.data?.nomination_seconds != null
    ? Number(settingsRes.data.nomination_seconds)
    : Number(settingsRes.data?.nomination_hours ?? 12) * 3600

if (!Number.isFinite(nominationSeconds) || nominationSeconds < 1) {
  return NextResponse.json({ error: 'Invalid nomination timer setting.' }, { status: 400 })
}

const endsAt = new Date(Date.now() + nominationSeconds * 1000).toISOString()

    // 4) Create auction
    const insRes = await supabaseAdmin
      .from('auctions')
      .insert({
        draft_id: draftId,
        player_id: playerId,
        nominated_by_team_id: null,
        high_bid: 0,
        high_team_id: null,
        ends_at: endsAt,
        last_bid_at: null,
        closed_at: null,
      })
      .select('id')
      .single()

    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 500 })

    // 5) Log event
    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'NOMINATE',
      payload: {
        auction_id: insRes.data.id,
        player_id: playerId,
        by_team_id: null,
        ends_at: endsAt,
      },
    })

    return NextResponse.json({ ok: true, auction_id: insRes.data.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}