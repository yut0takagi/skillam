import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard.js'
import { Roles } from './pages/Roles.js'
import { Catalog } from './pages/Catalog.js'
import { Settings } from './pages/Settings.js'

export function AppRoutes() {
  return (
    <>
      <nav>
        <Link to="/">プロジェクト</Link>
        <Link to="/roles">ロール</Link>
        <Link to="/catalog">カタログ</Link>
        <Link to="/settings">設定</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
