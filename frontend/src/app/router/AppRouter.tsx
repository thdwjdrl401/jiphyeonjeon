import { Route, Routes } from 'react-router-dom'
import GuestOnlyRoute from '@/features/auth/GuestOnlyRoute'
import CurriculumListPage from '@/pages/CurriculumListPage'
import LoginPage from '@/pages/LoginPage'
import NotFoundPage from '@/pages/NotFoundPage'
import SignupPage from '@/pages/SignupPage'
import WelcomePage from '@/pages/WelcomePage'
import PublicLayout from '@/shared/layout/PublicLayout'

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<WelcomePage />} />
        <Route path="curriculums" element={<CurriculumListPage />} />
        <Route element={<GuestOnlyRoute />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
