import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { App } from './app/App.tsx'
import '../ui/kit/tokens.css'
import './app/app.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing from index.html')
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
