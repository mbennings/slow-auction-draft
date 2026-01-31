import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const draft_id = String(body.draft_id ?? '').trim()
  if (!draft_id) return NextResponse.json({ error: 'Missing draft_id' }, { status: 400 })

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Find expired and still-open auctions
  const expiredRes = await supabaseAdmin
    .from('auctions')
    .select('id')
    .eq('draft_id', draft_id)
    .is('closed_at', null)
    .lte('ends_at', new Date().toISOString())

  if (expiredRes.error) {
    return NextResponse.json({ error: expiredRes.error.message }, { status: 400 })
  }

  const expired = expiredRes.data ?? []
  if (expired.length === 0) {
    return NextResponse.json({ finalized: 0 }, { status: 200 })
  }

  let finalized = 0
  const errors: string[] = []

  for (const a of expired) {
    const rpcRes = await supabaseAdmin.rpc('finalize_auction', { p_auction_id: a.id })
    if (rpcRes.error) {
      errors.push(`${a.id}: ${rpcRes.error.message}`)
    } else {
      finalized += 1
    }
  }

  return NextResponse.json({ finalized, errors }, { status: 200 })
}