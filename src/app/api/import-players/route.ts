import { NextResponse } from 'next/server'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const PRIMARY_POSITIONS = new Set([
  'C', '1B', '2B', 'SS', '3B', 'RF', 'CF', 'LF',
  'SP', 'SP/RP', 'RP', 'CP',
])

const SECONDARY_POSITIONS = new Set([
  'C', '1B', '2B', 'SS', '3B', 'RF', 'CF', 'LF',
  'IF', 'OF', 'IF/OF', '1B/OF',
])

function normPos(s: unknown) {
  return String(s ?? '').trim().toUpperCase()
}

function normText(s: unknown) {
  return String(s ?? '').trim()
}

function toKey(s: unknown) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '')
}

function toIntOrNull(s: unknown) {
  const n = Number(String(s ?? '').trim())
  return Number.isFinite(n) ? Math.round(n) : null
}

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
    const draftId = String(body?.draft_id ?? '').trim()
    const csv = String(body?.csv ?? '').trim()

    if (!draftId) {
      return NextResponse.json({ error: 'Missing draft_id.' }, { status: 400 })
    }
    if (!csv) {
      return NextResponse.json({ error: 'Players list is empty.' }, { status: 400 })
    }

    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => toKey(h),
    })

    if (parsed.errors.length) {
      return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 })
    }

    const rows = parsed.data as Record<string, unknown>[]
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows found.' }, { status: 400 })
    }

    const cleaned = rows
      .map((row) => {
        const name = normText(row.name)

        const primaryRaw = row.ppos ?? row.primary ?? row.pos1 ?? row.positionprimary ?? row.positionprimary
        const secondaryRaw = row.spos ?? row.secondary ?? row.pos2 ?? row.positionsecondary ?? row.positionsecondary
        const roleRaw = row.role

        const primary = normPos(primaryRaw || roleRaw)
        const secondary = normPos(secondaryRaw)

        if (!name) return null
        if (!primary) return { error: `Missing primary position/role for "${name}".` }
        if (!PRIMARY_POSITIONS.has(primary)) {
          return { error: `Invalid primary position/role "${primary}" for "${name}".` }
        }
        if (secondary && !SECONDARY_POSITIONS.has(secondary)) {
          return { error: `Invalid secondary position "${secondary}" for "${name}".` }
        }

        const isPitcher = ['SP', 'SP/RP', 'RP', 'CP'].includes(primary)

        const metadata: Record<string, unknown> = {
          position_primary: primary,
          player_type: isPitcher ? 'pitcher' : 'hitter',
        }

        if (secondary) metadata.position_secondary = secondary

        const arsenal = normText(row.arsenal)
        if (arsenal) metadata.arsenal = arsenal

        const pow = toIntOrNull(row.pow)
        const con = toIntOrNull(row.con)
        const spd = toIntOrNull(row.spd)
        const fld = toIntOrNull(row.fld)
        const arm = toIntOrNull(row.arm)
        const vel = toIntOrNull(row.vel)
        const jnk = toIntOrNull(row.jnk)
        const acc = toIntOrNull(row.acc)
        const age = toIntOrNull(row.age)

        if (pow != null) metadata.pow = pow
        if (con != null) metadata.con = con
        if (spd != null) metadata.spd = spd
        if (fld != null) metadata.fld = fld
        if (arm != null) metadata.arm = arm
        if (vel != null) metadata.vel = vel
        if (jnk != null) metadata.jnk = jnk
        if (acc != null) metadata.acc = acc
        if (age != null) metadata.age = age

        const trait1 = normText(row.trait1 ?? row.trait_1)
        const trait2 = normText(row.trait2 ?? row.trait_2)
        const batHand = normText(row.bathand ?? row.bat_hand)
        const throwHand = normText(row.throwhand ?? row.throw_hand)

        if (trait1) metadata.trait_1 = trait1
        if (trait2) metadata.trait_2 = trait2
        if (batHand) metadata.bat_hand = batHand
        if (throwHand) metadata.throw_hand = throwHand

        return {
          draft_id: draftId,
          name,
          metadata,
        }
      })
      .filter(Boolean)

    const firstErr = (cleaned as Array<{ error?: string }>).find((x) => x?.error)?.error
    if (firstErr) {
      return NextResponse.json({ error: firstErr }, { status: 400 })
    }

    const rowsToUpsert = cleaned as Array<{
      draft_id: string
      name: string
      metadata: Record<string, unknown>
    }>

    if (!rowsToUpsert.length) {
      return NextResponse.json({ error: 'No valid player rows found.' }, { status: 400 })
    }

    const up = await supabaseAdmin
      .from('players')
      .upsert(rowsToUpsert, { onConflict: 'draft_id,name' })

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 })
    }

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