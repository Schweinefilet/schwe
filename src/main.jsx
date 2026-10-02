import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import 'lenis/dist/lenis.css'
import './styles.css'
import App from './App.jsx'

// Dev-only lab pages (/?lab=drop). The import sits behind the DEV flag, so builds leave them out.
const lab = import.meta.env.DEV ? new URLSearchParams(location.search).get('lab') : null
const DropLab = import.meta.env.DEV ? lazy(() => import('./dev/DropLab.jsx')) : null

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {lab === 'drop' ? (
      <Suspense fallback={null}>
        <DropLab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
)
