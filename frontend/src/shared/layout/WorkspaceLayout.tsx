import { matchPath, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { isProfileAreaActive } from '@/app/router/navigation'
import { getNotificationsPath, getProfilePath, instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import CurriculumLessonNavigation from '@/features/lesson/CurriculumLessonNavigation'
import { getLiveSession } from '@/features/live-session/liveSessionService'
import ProfileAvatar from '@/features/profile/ProfileAvatar'
import GlobalHeader from './GlobalHeader'

interface LessonNavigationContext {
  curriculumId?: string
  lessonId?: string
  sessionId?: string
}

function getStudentLessonContext(pathname: string): LessonNavigationContext | null {
  const lessonMatch = matchPath('/student/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId', pathname)
  if (lessonMatch?.params.curriculumId && lessonMatch.params.lessonId) {
    return {
      curriculumId: lessonMatch.params.curriculumId,
      lessonId: lessonMatch.params.lessonId,
    }
  }

  const prejoinMatch = matchPath('/student/live-sessions/:sessionId/prejoin', pathname)
  if (prejoinMatch?.params.sessionId) {
    return { sessionId: prejoinMatch.params.sessionId }
  }

  return null
}

function getInstructorLessonContext(pathname: string): LessonNavigationContext | null {
  const curriculumMatch = matchPath('/instructor/curriculums/:curriculumId/manage', pathname)
    ?? matchPath('/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/new', pathname)
  if (curriculumMatch?.params.curriculumId) {
    return { curriculumId: curriculumMatch.params.curriculumId }
  }

  const lessonMatch = matchPath('/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId/edit', pathname)
    ?? matchPath('/instructor/curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId', pathname)
  if (lessonMatch?.params.curriculumId && lessonMatch.params.lessonId) {
    return {
      curriculumId: lessonMatch.params.curriculumId,
      lessonId: lessonMatch.params.lessonId,
    }
  }

  const preflightMatch = matchPath('/instructor/live-sessions/:sessionId/preflight', pathname)
  if (preflightMatch?.params.sessionId) {
    return { sessionId: preflightMatch.params.sessionId }
  }

  return null
}

export default function WorkspaceLayout() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const curriculumPath = isInstructor ? instructorPaths.curriculums : studentPaths.curriculums
  const profilePath = user ? getProfilePath(user.role) : studentPaths.profile
  /*
    알림 진입점은 내 프로필 화면에서만 사이드바에 낸다 — 헤더 종이 모든 화면의 상시 진입점이라
    사이드바까지 항상 같은 자리를 쓰면 같은 목적지가 두 번 상주한다. 계정 관련 화면에서만 보조로 둔다.
  */
  const showNotificationsLink = Boolean(user) && isProfileAreaActive(pathname)
  const lessonContext = user?.role === 'STUDENT'
    ? getStudentLessonContext(pathname)
    : user?.role === 'INSTRUCTOR'
      ? getInstructorLessonContext(pathname)
      : null
  // 사전 점검·입장 전 점검은 경로에 sessionId만 있어서 세션을 읽어 커리큘럼을 알아낸다.
  // 키는 페이지와 같은 ['live-session', sessionId]다 — 따로 두면 같은 세션을 두 번 받아 온다.
  const navigationSessionQuery = useQuery({
    queryKey: ['live-session', lessonContext?.sessionId],
    queryFn: () => getLiveSession(lessonContext!.sessionId!),
    enabled: Boolean(lessonContext?.sessionId),
  })
  const resolvedLessonContext = lessonContext?.curriculumId
    ? lessonContext
    : navigationSessionQuery.data
      ? {
          curriculumId: navigationSessionQuery.data.curriculumId,
          lessonId: navigationSessionQuery.data.lessonId,
        }
      : null
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">본문으로 바로가기</a>
      <GlobalHeader />
      <div className="workspace-frame page-container">
        {resolvedLessonContext?.curriculumId && user ? (
          <CurriculumLessonNavigation
            curriculumId={resolvedLessonContext.curriculumId}
            activeLessonId={resolvedLessonContext.lessonId}
            role={user.role}
          />
        ) : <aside className="workspace-sidebar" aria-label="작업 메뉴">
          <div className="workspace-sidebar__masthead" aria-hidden="true">
            <span>MY</span>
            <strong>CURATION</strong>
          </div>
          <div className="workspace-user">{user && <ProfileAvatar displayName={user.displayName} imageUrl={user.profileImageUrl} decorative />}<div><strong>{user?.displayName}</strong><small>{user?.role === 'INSTRUCTOR' ? '강사 워크스페이스' : '학생 워크스페이스'}</small></div></div>
          <nav>
            <span className="workspace-sidebar__nav-label" aria-hidden="true">ARCHIVE</span>
            <NavLink to={curriculumPath}>내 커리큘럼</NavLink>
            <NavLink to={profilePath}>내 프로필</NavLink>
          </nav>
          {showNotificationsLink && user && (
            <nav className="workspace-sidebar__footer-nav" aria-label="알림">
              <NavLink to={getNotificationsPath(user.role)}>전체 알림</NavLink>
            </nav>
          )}
          <div className="workspace-sidebar__tip"><strong>LiveClass AI</strong><p>라이브 준비부터 다시보기 학습까지 한 흐름으로 관리하세요.</p></div>
        </aside>}
        <main className="workspace-content" id="workspace-content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  )
}
