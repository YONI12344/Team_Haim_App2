'use client'

import { useState, useEffect } from 'react'
import { storage } from '@/lib/firebase'
import { ref, getDownloadURL, listAll } from 'firebase/storage'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { FileText, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Document {
  name: string
  url: string
  fullPath: string
  uploadedAt: string
}

export function AthleteDocumentsView({ compact = false }: { compact?: boolean }) {
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

  if (loading) {
    return (
      <p className="text-sm text-gray-400 py-2">{t.loadingDocuments}</p>
    )
  }

  if (documents.length === 0) {
    return (
      <div className={cn('text-center', compact ? 'py-6' : 'py-10')}>
        <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
          <FileText className="h-6 w-6 text-gray-300" />
        </div>
        <p className="text-sm font-medium text-gray-400">{t.noDocumentsYet}</p>
        <p className="text-xs text-gray-300 mt-1">{t.noDocumentsCoachWillUpload}</p>
      </div>
    )
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-3">
      {!compact && (
        <div className="mb-2">
          <p className="text-xs text-gray-400">{t.myDocumentsSubtitle}</p>
        </div>
      )}
      {documents.map((doc) => (
        <div
          key={doc.fullPath}
          className="flex items-center justify-between gap-3 p-3.5 bg-gray-50 rounded-2xl"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center flex-shrink-0 border border-gray-100">
              <FileText className="h-4 w-4 text-[#c9a84c]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#0a1628] truncate">{doc.name}</p>
              {doc.uploadedAt && (
                <p className="text-xs text-gray-400 mt-0.5">{t.uploadedLabel} {formatDate(doc.uploadedAt)}</p>
              )}
            </div>
          </div>
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0a1628] bg-white border border-gray-200 rounded-xl px-3 py-2 flex-shrink-0 active:scale-95 transition-transform"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t.openPdfBtn}
          </a>
        </div>
      ))}
    </div>
  )
}

