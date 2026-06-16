'use client'

import { useState, useEffect } from 'react'
import { storage } from '@/lib/firebase'
import { ref, getDownloadURL, listAll } from 'firebase/storage'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'

interface Document {
  name: string
  url: string
  fullPath: string
  uploadedAt: string
}

export function AthleteDocumentsView() {
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    const fetchDocs = async () => {
      try {
        const listRef = ref(storage, `athlete-documents/${user.id}`)
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
    fetchDocs()
  }, [user?.id])

  const formatDate = (ts: string) => {
    if (!ts) return ''
    try { return new Date(parseInt(ts)).toLocaleDateString('he-IL') } catch { return '' }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem', direction: isRTL ? 'rtl' : 'ltr', minHeight: '100vh', background: 'var(--color-background-primary)' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 4px' }}>{t.myDocumentsTitle}</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>{t.myDocumentsSubtitle}</p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{t.loadingDocuments}</p>
      ) : documents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)' }}>
          <p style={{ fontSize: 16, margin: '0 0 4px' }}>{t.noDocumentsYet}</p>
          <p style={{ fontSize: 14, margin: 0 }}>{t.noDocumentsCoachWillUpload}</p>
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
                  {doc.uploadedAt && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{t.uploadedLabel} {formatDate(doc.uploadedAt)}</p>}
                </div>
              </div>
              <a href={doc.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-primary)', textDecoration: 'none', background: 'var(--color-background-secondary)', flexShrink: 0 }}>
                {t.openPdfBtn}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
