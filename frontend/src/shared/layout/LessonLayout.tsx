import { Link, Outlet } from 'react-router-dom'
import { getRoleHomePath } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import BrandLink from './BrandLink'

export default function LessonLayout() {
  const { user } = useAuth()
  const curriculumLabel = user?.role === 'INSTRUCTOR' ? '커리큘럼 관리' : '내 커리큘럼'
  return (
    <div className="lesson-shell">
      <header className="lesson-shell__header"><BrandLink /><Link to={user ? getRoleHomePath(user.role) : '/'}>← {curriculumLabel}</Link><span>{user?.displayName}</span></header>
      <main id="lesson-content"><Outlet /></main>
    </div>
  )
}
