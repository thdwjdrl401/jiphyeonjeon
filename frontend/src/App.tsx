import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { AuthProvider } from '@/contexts/AuthContext'
import { MenuProvider } from '@/contexts/MenuContext'
import { ConferenceDetailPage } from '@/pages/ConferenceDetailPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { HomePage } from '@/pages/HomePage'

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <MenuProvider>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/conferences/:conferenceId" element={<ConferenceDetailPage />} />
            </Route>
          </Routes>
        </MenuProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
