import { NextResponse } from 'next/server'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const PRIMARY_POSITIONS = new Set([
  'C','1B','2B','SS','3B','RF','CF','LF',
  'SP','SP/RP','RP','CP',
])
const SECONDARY_POSITIONS = new Set([
  'C','1B','2B','SS','3B','RF','CF','LF',
  'IF','OF','IF/OF','1B/OF',
])

function normPos(s: unknown) {
  return String(s ?? '').trim().toUpperCase()
}

function isAdmin(req: Request) {
  const adminCode = req.headers.get('x-admin-code') ?? ''
  return adminCode && adminCode === (process.env.ADMIN_CODE ?? '')
}

export async function POST(req: Request) {
  try {
    if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

    const body = await req.json()
    const draftId = String(body?.draft_id ?? '')
    const csv = String(body?.csv ?? '').trim()

    if (!draftId) return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    if (!csv) return NextResponse.json({ error: 'Players list is empty.' }, { status: 400 })

    const parsed = Papa.parse(csv, { header: false, skipEmptyLines: true })
    if (parsed.errors.length) return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 })

    const rowsAny = parsed.data as any[]
    if (!rowsAny.length) return NextResponse.json({ error: 'No rows found.' }, { status: 400 })

    const firstRow = Array.isArray(rowsAny[0]) ? rowsAny[0].map((x: any) => String(x ?? '').trim()) : []
    const firstLower = firstRow.map((s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/_/g, ''))

    const looksLikeHeader =
      firstLower.includes('name') &&
      (firstLower.includes('primary') ||
        firstLower.includes('pos1') ||
        firstLower.includes('positionprimary') ||
        firstLower.includes('position_primary'))

    let dataRows: any[] = rowsAny
    let colIndex = { name: 0, primary: 1, secondary: 2 }

    if (looksLikeHeader) {
      const header = firstLower
      const idx = (keys: string[]) => header.findIndex((h: string) => keys.includes(h))

      const nameIdx = idx(['name'])
      const primaryIdx = idx(['primary', 'pos1', 'positionprimary', 'position_primary'])
      const secondaryIdx = idx(['secondary', 'pos2', 'positionsecondary', 'position_secondary'])

      if (nameIdx === -1) return NextResponse.json({ error: 'Header must include "name".' }, { status: 400 })
      if (primaryIdx === -1) return NextResponse.json({ error: 'Header must include "primary" (or pos1).' }, { status: 400 })

      colIndex = { name: nameIdx, primary: primaryIdx, secondary: secondaryIdx === -1 ? -1 : secondaryIdx }
      dataRows = rowsAny.slice(1)
    }

    const cleaned = dataRows
      .map((row) => {
        const arr = Array.isArray(row) ? row : []
        const name = String(arr[colIndex.name] ?? '').trim()
        const primary = normPos(arr[colIndex.primary])
        const secondary = colIndex.secondary >= 0 ? normPos(arr[colIndex.secondary]) : ''

        if (!name) return null
        if (!primary) return { error: `Missing primary position for "${name}".` }
        if (!PRIMARY_POSITIONS.has(primary)) return { error: `Invalid primary position "${primary}" for "${name}".` }
        if (secondary && !SECONDARY_POSITIONS.has(secondary)) return { error: `Invalid secondary position "${secondary}" for "${name}".` }

        const metadata: any = { position_primary: primary }
        if (secondary) metadata.position_secondary = secondary

        return { draft_id: draftId, name, metadata }
      })
      .filter(Boolean)

    const firstErr = (cleaned as any[]).find((x) => x?.error)?.error
    if (firstErr) return NextResponse.json({ error: firstErr }, { status: 400 })

    const rowsToUpsert = cleaned as any[]
    if (!rowsToUpsert.length) return NextResponse.json({ error: 'No valid player rows found.' }, { status: 400 })

    const up = await supabaseAdmin.from('players').upsert(rowsToUpsert, { onConflict: 'draft_id,name' })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

    await supabaseAdmin.from('draft_events').insert({
      draft_id: draftId,
      event_type: 'IMPORT_PLAYERS',
      payload: { count: rowsToUpsert.length },
    })

    return NextResponse.json({ ok: true, count: rowsToUpsert.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}