import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  // 1) Admin check
  const adminCode = req.headers.get('x-admin-code') ?? ''
  const expected = process.env.ADMIN_CODE ?? ''
  if (!expected || adminCode !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2) Parse body
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const draft_id = String(body.draft_id ?? '').trim()
  const nomination_seconds = Number(body.nomination_seconds)
const bid_seconds = Number(body.bid_seconds)

if (!Number.isFinite(nomination_seconds) || nomination_seconds < 0) {
  return NextResponse.json({ error: 'Invalid nomination_seconds' }, { status: 400 })
}
if (!Number.isFinite(bid_seconds) || bid_seconds < 0) {
  return NextResponse.json({ error: 'Invalid bid_seconds' }, { status: 400 })
}

  // 3) Service role client bypasses RLS
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 4) Upsert settings (draft_id should be unique / PK)
  const up = await supabaseAdmin
    .from('draft_settings')
    .upsert(
  {
    draft_id,
    nomination_seconds,
    bid_seconds,
    // optional: keep legacy hours in sync for readability/back-compat
    nomination_hours: Math.floor(nomination_seconds / 3600),
    bid_hours: Math.floor(bid_seconds / 3600),
  },
  { onConflict: 'draft_id' }
)

  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 })

  return NextResponse.json({ ok: true }, { status: 200 })
}