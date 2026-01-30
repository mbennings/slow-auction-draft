'use client'

import { useEffect, useState } from 'react'
import DraftApp from '@/components/DraftApp'

export default function AdminPage() {
  const [code, setCode] = useState('')
  const [authed, setAuthed] = useState(false)
  const [err, setErr] = useState('')

  // Load prior auth from sessionStorage
useEffect(() => {
  const v = localStorage.getItem('admin_authed')
  if (v === 'true') setAuthed(true)
}, [])

  async function submit() {
    setErr('')
    const res = await fetch('/api/admin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    if (!res.ok) {
      setErr('Invalid admin code.')
      return
    }

    localStorage.setItem('admin_authed', 'true')
    localStorage.setItem('admin_code', code)
    setAuthed(true)
  }

  function logout() {
    localStorage.removeItem('admin_authed')
    localStorage.removeItem('admin_code')
    setAuthed(false)
    setCode('')
  }

  if (!authed) {
    return (
      <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '0 auto' }}>
        <h1>Admin Access</h1>
        <p>Enter the admin code to continue.</p>

        {err && <p style={{ color: 'crimson' }}>{err}</p>}

        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Admin code"
          style={{ width: '100%', padding: 10, marginTop: 8 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />

        <button
          onClick={submit}
          style={{ marginTop: 12, padding: '10px 14px', cursor: 'pointer' }}
        >
          Unlock Admin
        </button>
      </main>
    )
  }

  return (
    <>
      <div style={{ padding: 12, textAlign: 'right' }}>
        <button onClick={logout} style={{ cursor: 'pointer' }}>
          Logout Admin
        </button>
      </div>

      <DraftApp showAdmin={true} />
    </>
  )
}