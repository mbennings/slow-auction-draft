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

    const auctionId = String(body?.auction_id ?? '')
    if (!auctionId) return NextResponse.json({ error: 'Missing auction_id.' }, { status: 400 })

    const res = await supabaseAdmin.rpc('finalize_auction', { p_auction_id: auctionId })

    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })

    // Your rpc returns [{status: "..."}]
    const status =
      Array.isArray(res.data) && res.data[0]?.status
        ? String(res.data[0].status)
        : 'UNKNOWN'

    return NextResponse.json({ ok: true, status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}