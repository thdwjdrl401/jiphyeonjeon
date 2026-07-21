import { matchPath, NavLink, Outlet, useLocation } from 'react-router-dom'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getDemoLiveSession } from '@/features/demo/demoData'
import CurriculumLessonNavigation from '@/features/lesson/CurriculumLessonNavigation'
import GlobalHeader from './GlobalHeader'

interface LessonNavigationContext {
  curriculumId: string
  lessonId?: string
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
    const session = getDemoLiveSession(prejoinMatch.params.sessionId)
    return {
      curriculumId: session.curriculumId,
      lessonId: session.lessonId,
    }
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
    const session = getDemoLiveSession(preflightMatch.params.sessionId)
    return {
      curriculumId: session.curriculumId,
      lessonId: session.lessonId,
    }
  }

  return null
}

export default function WorkspaceLayout() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const curriculumPath = isInstructor ? instructorPaths.curriculums : studentPaths.curriculums
  const profilePath = isInstructor ? instructorPaths.profile : studentPaths.profile
  const lessonContext = user?.role === 'STUDENT'
    ? getStudentLessonContext(pathname)
    : user?.role === 'INSTRUCTOR'
      ? getInstructorLessonContext(pathname)
      : null
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">본문으로 바로가기</a>
      <GlobalHeader />
      <div className="workspace-frame page-container">
        {lessonContext && user ? (
          <CurriculumLessonNavigation
            curriculumId={lessonContext.curriculumId}
            activeLessonId={lessonContext.lessonId}
            role={user.role}
          />
        ) : <aside className="workspace-sidebar" aria-label="작업 메뉴">
          <div className="workspace-user"><span>{user?.displayName.slice(0, 1)}</span><div><strong>{user?.displayName}</strong><small>{user?.role === 'INSTRUCTOR' ? '강사 워크스페이스' : '학생 워크스페이스'}</small></div></div>
          <nav>
            <NavLink to={curriculumPath}>내 커리큘럼</NavLink>
            <NavLink to={profilePath}>내 프로필</NavLink>
          </nav>
          <div className="workspace-sidebar__tip"><strong>LiveClass AI</strong><p>라이브 준비부터 다시보기 학습까지 한 흐름으로 관리하세요.</p></div>
        </aside>}
        <main className="workspace-content" id="workspace-content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  )
}
