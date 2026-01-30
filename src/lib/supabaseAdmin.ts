import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url) throw new Error('Missing SUPABASE_URL in environment.')
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in environment.')

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
})