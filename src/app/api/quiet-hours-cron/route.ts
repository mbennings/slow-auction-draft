import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret') ?? ''
    const draftId = url.searchParams.get('draft_id') ?? ''

    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Missing CRON_SECRET env var.' }, { status: 500 })
    }

    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }

    const rpcRes = await supabaseAdmin.rpc('apply_quiet_hours', { p_draft_id: draftId })
    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}