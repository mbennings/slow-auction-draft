import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Papa from 'papaparse'

export async function POST(req: Request) {
  const adminCode = req.headers.get('x-admin-code') ?? ''
  const expected = process.env.ADMIN_CODE ?? ''

  if (!expected || adminCode !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const draft_id = String(body.draft_id ?? '').trim()
  const csv = String(body.csv ?? '')

  if (!draft_id) return NextResponse.json({ error: 'Missing draft_id' }, { status: 400 })
  if (!csv.trim()) return NextResponse.json({ error: 'Missing csv' }, { status: 400 })

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Safety checks (same idea as your client code)
  const [openAuctions, draftedPlayers] = await Promise.all([
    supabaseAdmin
      .from('auctions')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draft_id)
      .is('closed_at', null),

    supabaseAdmin
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draft_id)
      .not('drafted_by_team_id', 'is', null),
  ])

  if (openAuctions.error) return NextResponse.json({ error: openAuctions.error.message }, { status: 400 })
  if (draftedPlayers.error) return NextResponse.json({ error: draftedPlayers.error.message }, { status: 400 })

  if ((openAuctions.count ?? 0) > 0 || (draftedPlayers.count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot replace teams while draft has data. Auctions: ${openAuctions.count ?? 0}, Drafted players: ${draftedPlayers.count ?? 0}. Run Reset Draft first.` },
      { status: 400 }
    )
  }

  // Parse CSV (strip BOM)
  const cleaned = csv.replace(/^\uFEFF/, '').trim()
  const parsed = Papa.parse(cleaned, { header: true, skipEmptyLines: true })

  if (parsed.errors?.length) {
    return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 })
  }

  const rowsRaw = parsed.data as any[]
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return NextResponse.json({ error: 'No CSV rows found.' }, { status: 400 })
  }

  const rows: any[] = rowsRaw
    .map((r, idx) => {
      const rowNum = idx + 2
      const name = String(r.name ?? '').trim()
      const code = String(r.code ?? r.join_code ?? '').trim()
      const budget = Number(String(r.budget ?? '').replace(/[^0-9.-]/g, '').trim())
      const hitterSpots = Number(
        String(
          r.hitter_spots ??
          r.Hitter_spots ??
          r.HITTER_SPOTS ??
          r.hitters ??
          ''
        )
          .replace(/[^0-9.-]/g, '')
          .trim()
      )

      const pitcherSpots = Number(
        String(
          r.pitcher_spots ??
          r.Pitcher_spots ??
          r.PITCHER_SPOTS ??
          r.pitchers ??
          ''
        )
          .replace(/[^0-9.-]/g, '')
          .trim()
      )

      const totalSpots = hitterSpots + pitcherSpots

      if (!name) return { error: `Row ${rowNum}: missing name` }
      if (!code) return { error: `Row ${rowNum}: missing code for "${name}"` }
      if (!Number.isFinite(budget) || budget <= 0) return { error: `Row ${rowNum}: invalid budget for "${name}"` }
      if (!Number.isFinite(hitterSpots) || hitterSpots < 0)
        return { error: `Row ${rowNum}: invalid hitter_spots for "${name}"` }

      if (!Number.isFinite(pitcherSpots) || pitcherSpots < 0)
        return { error: `Row ${rowNum}: invalid pitcher_spots for "${name}"` }

      if (totalSpots <= 0)
        return { error: `Row ${rowNum}: hitter_spots + pitcher_spots must be greater than 0 for "${name}"` }

      return {
        draft_id,
        name,
        join_code: code,
        budget_total: budget,
        budget_remaining: budget,
        hitter_spots_total: hitterSpots,
        hitter_spots_remaining: hitterSpots,
        pitcher_spots_total: pitcherSpots,
        pitcher_spots_remaining: pitcherSpots,
        roster_spots_total: totalSpots,
        roster_spots_remaining: totalSpots,
      }
    })
    .filter(Boolean)

  const firstErr = rows.find((x) => x?.error)?.error
  if (firstErr) return NextResponse.json({ error: firstErr }, { status: 400 })
  if (!rows.length) return NextResponse.json({ error: 'No valid team rows found.' }, { status: 400 })

  // Delete + insert
  const del = await supabaseAdmin.from('teams').delete().eq('draft_id', draft_id)
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 })

  const up = await supabaseAdmin.from('teams').upsert(rows, { onConflict: 'draft_id,name' })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 })

  await supabaseAdmin
    .from('nomination_order')
    .delete()
    .eq('draft_id', draft_id)

  const teamsForOrderRes = await supabaseAdmin
    .from('teams')
    .select('id,name,draft_id')
    .eq('draft_id', draft_id)
    .order('name', { ascending: true })

  if (teamsForOrderRes.error) {
    return NextResponse.json({ error: teamsForOrderRes.error.message }, { status: 400 })
  }

  const orderRows = (teamsForOrderRes.data ?? []).map((team, idx) => ({
    draft_id,
    team_id: team.id,
    sort_order: idx + 1,
  }))

  if (orderRows.length > 0) {
    const orderRes = await supabaseAdmin
      .from('nomination_order')
      .insert(orderRows)

    if (orderRes.error) {
      return NextResponse.json({ error: orderRes.error.message }, { status: 400 })
    }
  }

  await supabaseAdmin.from('draft_events').insert({
    draft_id,
    event_type: 'REPLACE_TEAMS',
    payload: { count: rows.length },
  })

  return NextResponse.json({ count: rows.length }, { status: 200 })
}