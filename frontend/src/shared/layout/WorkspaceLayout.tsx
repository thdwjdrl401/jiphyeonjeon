import { NavLink, Outlet } from 'react-router-dom'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import GlobalHeader from './GlobalHeader'

export default function WorkspaceLayout() {
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const curriculumPath = isInstructor ? instructorPaths.curriculums : studentPaths.curriculums
  const profilePath = isInstructor ? instructorPaths.profile : studentPaths.profile
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">본문으로 바로가기</a>
      <GlobalHeader />
      <div className="workspace-frame page-container">
        <aside className="workspace-sidebar" aria-label="작업 메뉴">
          <div className="workspace-user"><span>{user?.displayName.slice(0, 1)}</span><div><strong>{user?.displayName}</strong><small>{user?.role === 'INSTRUCTOR' ? '강사 워크스페이스' : '학생 워크스페이스'}</small></div></div>
          <nav>
            <NavLink to={curriculumPath}>내 커리큘럼</NavLink>
            {isInstructor && <NavLink to={instructorPaths.newCurriculum}>커리큘럼 만들기</NavLink>}
            <NavLink to={profilePath}>내 프로필</NavLink>
          </nav>
          <div className="workspace-sidebar__tip"><strong>LiveClass AI</strong><p>라이브 준비부터 다시보기 학습까지 한 흐름으로 관리하세요.</p></div>
        </aside>
        <main className="workspace-content" id="workspace-content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  )
}
