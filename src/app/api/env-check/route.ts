import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    hasUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasAdminCode: Boolean(process.env.ADMIN_CODE),
  })
}