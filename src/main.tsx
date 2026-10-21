import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTauri } from '@tauri-apps/api/core'
import { vibrancyUnavailable } from './platform'

// The desktop window is transparent so macOS vibrancy shows through; the browser preview draws its own backdrop.
document.documentElement.classList.toggle('native', isTauri())
// Windows and Linux have no vibrancy: paint solid from the first frame (settings.ts keeps it that way).
document.documentElement.classList.toggle('solid', vibrancyUnavailable())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
