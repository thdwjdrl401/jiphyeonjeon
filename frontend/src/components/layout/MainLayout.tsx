import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Footer } from './Footer'
import { Header } from './Header'
import { LoginDialog } from './LoginDialog'
import { Sidebar } from './Sidebar'

export function MainLayout() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)

  return (
    <div className="main-wrapper">
      <Header onOpenLogin={() => setIsLoginOpen(true)} />
      <div className="main-container">
        <Sidebar />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
      <Footer />
      <LoginDialog open={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </div>
  )
}
