import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Papa from 'papaparse'

export async function POST(req: Request) {
  // 1) Admin check
  const adminCode = req.headers.get('x-admin-code') ?? ''
  const expected = process.env.ADMIN_CODE ?? ''

  if (!expected || adminCode !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2) Read body
  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const draft_id = String(body.draft_id ?? '').trim()
  const csv = String(body.csv ?? '')

  if (!draft_id) {
    return NextResponse.json({ error: 'Missing draft_id' }, { status: 400 })
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: 'Missing csv' }, { status: 400 })
  }

  // 3) Server-side Supabase client (service role bypasses RLS)
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 4) Parse CSV (strip BOM, require headers)
  const cleaned = csv.replace(/^\uFEFF/, '').trim()
  const parsed = Papa.parse(cleaned, { header: true, skipEmptyLines: true })

  if (parsed.errors?.length) {
    return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 })
  }

  const rowsRaw = parsed.data as any[]
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return NextResponse.json({ error: 'No CSV rows found.' }, { status: 400 })
  }

  // 5) Validate + normalize
  const rows: any[] = rowsRaw
    .map((r, idx) => {
      // idx is 0-based; +2 accounts for header row + human-friendly numbering
      const rowNum = idx + 2

      const name = String(r.name ?? '').trim()
      const code = String(r.code ?? r.join_code ?? '').trim()

      const budget = Number(String(r.budget ?? '').replace(/[^0-9.-]/g, '').trim())
      const spots = Number(
        String(r.spots ?? r.roster_spots ?? r.roster_spots_total ?? '')
          .replace(/[^0-9.-]/g, '')
          .trim()
      )

      if (!name) return { error: `Row ${rowNum}: missing name` }
      if (!code) return { error: `Row ${rowNum}: missing code for "${name}"` }
      if (!Number.isFinite(budget) || budget <= 0)
        return { error: `Row ${rowNum}: invalid budget for "${name}"` }
      if (!Number.isFinite(spots) || spots <= 0)
        return { error: `Row ${rowNum}: invalid spots for "${name}"` }

      return {
        draft_id,
        name,
        join_code: code,
        budget_total: budget,
        budget_remaining: budget,
        roster_spots_total: spots,
        roster_spots_remaining: spots,
      }
    })
    .filter(Boolean)

  const firstErr = rows.find((x) => x?.error)?.error
  if (firstErr) {
    return NextResponse.json({ error: firstErr }, { status: 400 })
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'No valid team rows found.' }, { status: 400 })
  }

  // 6) Upsert into teams
  const up = await supabaseAdmin
    .from('teams')
    .upsert(rows, { onConflict: 'draft_id,name' })

  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 400 })
  }

  // Optional: log an event (safe even if RLS is strict, since service role)
  await supabaseAdmin.from('draft_events').insert({
    draft_id,
    event_type: 'IMPORT_TEAMS',
    payload: { count: rows.length },
  })

  return NextResponse.json({ count: rows.length }, { status: 200 })
}