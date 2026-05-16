import type { Metadata, Viewport } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/contexts/auth-context'
import './globals.css'

const playfair = Playfair_Display({ 
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Team Haim | Elite Athletic Performance',
  description: 'Premium athletic coaching and performance tracking platform for elite athletes and coaches.',
  generator: 'v0.app',
  keywords: ['athletics', 'coaching', 'training', 'performance', 'track and field'],
  // To change the app icon (favicon / launcher / Safari pinned tab), replace
  // /public/team-haim-logo.png. PNG icon sizes live at
  // /public/icon-{size}x{size}.png and apple-icon.png.
  // The `?v=` query string forces browsers and OS launchers to fetch the new
  // artwork instead of serving a previously cached icon. Bump this value any
  // time the icon assets are replaced.
  icons: {
    icon: [
      {
        url: '/icon-32x32.png?v=3',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        url: '/icon-192x192.png?v=3',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/icon-512x512.png?v=3',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    apple: '/apple-icon.png?v=3',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a2744',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable} bg-background`}>
      <body className="font-sans antialiased min-h-screen">
        <AuthProvider>
          {children}
          <Toaster 
            position="top-right" 
            toastOptions={{
              style: {
                background: 'var(--card)',
                color: 'var(--card-foreground)',
                border: '1px solid var(--border)',
              },
            }}
          />
        </AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
