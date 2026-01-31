import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const draft_id = String(body.draft_id ?? '').trim()
  const code = String(body.code ?? '').trim()

  if (!draft_id) return NextResponse.json({ error: 'Missing draft_id' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const res = await supabaseAdmin
    .from('teams')
    .select('id,name')
    .eq('draft_id', draft_id)
    .eq('join_code', code)
    .maybeSingle()

  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400 })
  if (!res.data) return NextResponse.json({ error: 'Invalid team code.' }, { status: 400 })

  return NextResponse.json({ team_id: res.data.id, team_name: res.data.name }, { status: 200 })
}