'use client'

import { useState, useEffect, useRef } from 'react'
import { storage } from '@/lib/firebase'
import { ref, uploadBytesResumable, getDownloadURL, listAll, deleteObject } from 'firebase/storage'
import { useAuth } from '@/contexts/auth-context'

interface Document {
  name: string
  url: string
  fullPath: string
  uploadedAt: string
}

export function AthleteDocuments({ athleteId }: { athleteId: string }) {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchDocuments = async () => {
    try {
      const listRef = ref(storage, `athlete-documents/${athleteId}`)
      const res = await listAll(listRef)
      const docs = await Promise.all(
        res.items.map(async (item) => {
          const url = await getDownloadURL(item)
          const nameParts = item.name.split('___')
          const displayName = nameParts.length > 1 ? nameParts.slice(1).join('___') : item.name
          const uploadedAt = nameParts[0] || ''
          return { name: displayName, url, fullPath: item.fullPath, uploadedAt }
        })
      )
      docs.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      setDocuments(docs)
    } catch (e) {
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDocuments() }, [athleteId])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') { alert('Please upload a PDF file only.'); return }
    if (file.size > 10 * 1024 * 1024) { alert('File must be under 10MB.'); return }

    setUploading(true)
    setProgress(0)
    const timestamp = Date.now().toString()
    const storageRef = ref(storage, `athlete-documents/${athleteId}/${timestamp}___${file.name}`)
    const task = uploadBytesResumable(storageRef, file)

    task.on('state_changed',
      (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => { console.error(err); setUploading(false) },
      async () => { await fetchDocuments(); setUploading(false); setProgress(0); if (fileRef.current) fileRef.current.value = '' }
    )
  }

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.name}"?`)) return
    setDeleting(doc.fullPath)
    try {
      await deleteObject(ref(storage, doc.fullPath))
      await fetchDocuments()
    } catch (e) { console.error(e) }
    finally { setDeleting(null) }
  }

  const formatDate = (ts: string) => {
    if (!ts) return ''
    try { return new Date(parseInt(ts)).toLocaleDateString('he-IL') } catch { return '' }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem', direction: 'rtl' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 4px' }}>מסמכים וקבצי PDF</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>העלה תוכניות פיזיותרפיה, מתיחות, תרגילים וכל מסמך רלוונטי לספורטאי</p>
      </div>

      <div style={{ background: 'var(--color-background-secondary)', borderRadius: 12, padding: '1.5rem', marginBottom: '2rem', border: '0.5px solid var(--color-border-tertiary)' }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 12px' }}>העלאת מסמך חדש</p>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={handleUpload} disabled={uploading}
          style={{ fontSize: 14, color: 'var(--color-text-primary)', marginBottom: 12, display: 'block' }} />
        {uploading && (
          <div style={{ marginTop: 8 }}>
            <div style={{ background: 'var(--color-border-tertiary)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
              <div style={{ background: '#1a2744', height: '100%', width: `${progress}%`, transition: 'width 0.3s', borderRadius: 99 }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>מעלה... {progress}%</p>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '8px 0 0' }}>PDF בלבד · מקסימום 10MB</p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>טוען מסמכים...</p>
      ) : documents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)' }}>
          <p style={{ fontSize: 16, margin: '0 0 4px' }}>אין מסמכים עדיין</p>
          <p style={{ fontSize: 14, margin: 0 }}>העלה את המסמך הראשון למעלה</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {documents.map((doc) => (
            <div key={doc.fullPath} style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 12, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, background: '#FCEBEB', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 16 }}>📄</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</p>
                  {doc.uploadedAt && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>הועלה: {formatDate(doc.uploadedAt)}</p>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <a href={doc.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-primary)', textDecoration: 'none', background: 'var(--color-background-secondary)' }}>
                  פתח
                </a>
                <button onClick={() => handleDelete(doc)} disabled={deleting === doc.fullPath}
                  style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '0.5px solid #F09595', color: '#A32D2D', background: '#FCEBEB', cursor: 'pointer' }}>
                  {deleting === doc.fullPath ? '...' : 'מחק'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
