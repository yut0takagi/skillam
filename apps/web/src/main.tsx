import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
// フォントを同梱する。外部CDNに依存するとオフラインで書体が落ちるため。
// 実際に使うウェイト（400/500/600）の latin subset のみを読み込む。
// 日本語グリフは Plex に無いので、styles.css のフォールバックスタックで
// OS のフォント（Hiragino Sans / Noto Sans JP）に落ちる。
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
