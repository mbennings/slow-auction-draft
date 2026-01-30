import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const code = String(body?.code ?? '')

  const expected = process.env.ADMIN_CODE ?? ''
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'ADMIN_CODE not set on server.' }, { status: 500 })
  }

  if (code !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}