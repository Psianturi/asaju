import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from "react-error-boundary";

import App from './App.tsx'
import { LandingPage } from './LandingPage.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { BlockchainProvider } from './hooks/useBlockchain'
import { privyEnabled } from './lib/privy'
import { lazy, Suspense, type ReactNode } from 'react'

// Wraps the app in Privy only when an app id is configured.
const PrivyRoot = lazy(() => import('./components/PrivyBridge').then(m => ({ default: m.PrivyRoot })))
function MaybePrivy({ children }: { children: ReactNode }) {
  if (!privyEnabled) return <>{children}</>
  return <Suspense fallback={null}><PrivyRoot>{children}</PrivyRoot></Suspense>
}

import "./main.css"
import "./styles/theme.css"
import "./index.css"

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/dashboard/*"
          element={
            <MaybePrivy>
              <BlockchainProvider>
                <App />
              </BlockchainProvider>
            </MaybePrivy>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
)
