import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTauri } from '@tauri-apps/api/core'

// The desktop window is transparent so macOS vibrancy shows through; the browser preview draws its own backdrop.
document.documentElement.classList.toggle('native', isTauri())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
