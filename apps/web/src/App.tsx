import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard.js'
import { Roles } from './pages/Roles.js'
import { Catalog } from './pages/Catalog.js'
import { Settings } from './pages/Settings.js'

export function AppRoutes() {
  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">
          <div className="brand-mark">
            skill<span className="dim">am</span>
          </div>
          <div className="brand-sub">ローカル設定マネージャ</div>
        </div>
        <div className="nav">
          <NavLink to="/" className="nav-item" end>
            プロジェクト
          </NavLink>
          <NavLink to="/roles" className="nav-item">
            ロール
          </NavLink>
          <NavLink to="/catalog" className="nav-item">
            カタログ
          </NavLink>
          <NavLink to="/settings" className="nav-item">
            設定
          </NavLink>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}
