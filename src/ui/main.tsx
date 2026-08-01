import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { App } from './app/App.tsx'
import '../ui/kit/tokens.css'
import './app/app.css'
// Panel stylesheets. Each lane owns its own; tokens.css must load first so the
// custom properties exist before any panel references them.
import '../ui/nav/nav.css'
import '../ui/grid/grid.css'
import '../ui/viewer/viewer.css'
import '../ui/thumbs/thumbs.css'
import '../ui/scan/scan.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing from index.html')
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
