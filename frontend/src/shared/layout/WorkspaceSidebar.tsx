import { NavLink } from 'react-router-dom'
import { getNotificationsPath, getProfilePath, instructorPaths, studentPaths } from '@/app/router/paths'
import type { AuthUser } from '@/features/auth/types'
import ProfileAvatar from '@/features/profile/ProfileAvatar'

interface WorkspaceSidebarProps {
  user: AuthUser | null
}

/** 마이페이지와 역할별 커리큘럼 목록에서 공통으로 사용하는 워크스페이스 탐색 사이드바. */
export default function WorkspaceSidebar({ user }: WorkspaceSidebarProps) {
  const curriculumLabel = user?.role === 'INSTRUCTOR' ? '커리큘럼 관리' : '내 커리큘럼'
  const curriculumPath = user?.role === 'INSTRUCTOR'
    ? instructorPaths.curriculums
    : studentPaths.curriculums
  const profilePath = user ? getProfilePath(user.role) : studentPaths.profile
  const notificationsPath = user
    ? getNotificationsPath(user.role)
    : studentPaths.notifications

  return (
    <aside className="workspace-sidebar" aria-label="작업 메뉴">
      <div className="workspace-sidebar__masthead" aria-hidden="true">
        <span>MY</span>
        <strong>PAGE</strong>
      </div>
      <div className="workspace-user">
        {user && (
          <ProfileAvatar
            displayName={user.displayName}
            imageUrl={user.profileImageUrl}
            decorative
          />
        )}
        <div>
          <strong>{user?.displayName}</strong>
          <small>{user?.role === 'INSTRUCTOR' ? '강사 워크스페이스' : '학생 워크스페이스'}</small>
        </div>
      </div>
      <nav>
        <span className="workspace-sidebar__nav-label" aria-hidden="true">ARCHIVE</span>
        <NavLink to={curriculumPath}>{curriculumLabel}</NavLink>
        <NavLink to={profilePath}>내 프로필</NavLink>
        <NavLink to={notificationsPath}>전체 알림</NavLink>
      </nav>
      <div className="workspace-sidebar__tip">
        <strong>LiveClass AI</strong>
        <p>라이브 준비부터 다시보기 학습까지 한 흐름으로 관리하세요.</p>
      </div>
    </aside>
  )
}
