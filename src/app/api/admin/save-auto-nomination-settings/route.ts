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
    const isEnabled = Boolean(body?.is_enabled)
    const frequencySeconds = Number(body?.frequency_seconds)
    const maxActiveAuctions = Number(body?.max_active_auctions)

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    if (!Number.isFinite(frequencySeconds) || frequencySeconds < 1) {
      return NextResponse.json({ error: 'Invalid frequency_seconds.' }, { status: 400 })
    }

    if (!Number.isFinite(maxActiveAuctions) || maxActiveAuctions < 1) {
      return NextResponse.json({ error: 'Invalid max_active_auctions.' }, { status: 400 })
    }

    const up = await supabaseAdmin
      .from('draft_auto_nomination_state')
      .upsert(
        {
          draft_id: draftId,
          is_enabled: isEnabled,
          frequency_seconds: frequencySeconds,
          max_active_auctions: maxActiveAuctions,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'draft_id' }
      )

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 })
    }

    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'ADMIN_SAVE_AUTO_NOMINATION_SETTINGS',
      payload: {
        is_enabled: isEnabled,
        frequency_seconds: frequencySeconds,
        max_active_auctions: maxActiveAuctions,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}