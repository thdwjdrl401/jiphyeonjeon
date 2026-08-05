import { Link, Outlet, useMatch } from 'react-router-dom'
import { getRoleHomePath } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import BrandLink from './BrandLink'

/**
 * 라이브 강의실(classroom)·다시보기(replay)는 이 헤더를 숨긴다.
 *
 * 두 화면 모두 영상 위 "재생 정보" 헤더(호버로 뜨는 오버레이)가 브랜드·돌아가기 버튼을 대신 품는다
 * (PlaybackPlayer·InstructorLiveKitStage 참고) — 화면 위에 두 겹의 헤더를 둘 이유가 없고,
 * 비워진 58px만큼 영상·사이드 패널이 커진다(learning.css
 * `.media-page--live:not(.replay-page), .media-page--live.replay-page:not(.recorded-learning-page)`).
 *
 * 녹화강의(recorded)는 뺀다 — 그 화면은 재생 정보 헤더가 없는 별도 `.media-page__title`만
 * 쓰고 있어, 지금 이 헤더를 없애면 브랜드·돌아가기·이름을 담을 자리가 사라진다.
 */
function useHidesLessonNav() {
  const classroomStudent = useMatch('/student/live-sessions/:sessionId/classroom')
  const classroomInstructor = useMatch('/instructor/live-sessions/:sessionId/classroom')
  const replayStudent = useMatch('/student/lessons/:lessonId/replay')
  const replayInstructor = useMatch('/instructor/lessons/:lessonId/replay')
  return Boolean(classroomStudent || classroomInstructor || replayStudent || replayInstructor)
}

export default function LessonLayout() {
  const { user } = useAuth()
  const hideNav = useHidesLessonNav()
  const curriculumLabel = user?.role === 'INSTRUCTOR' ? '커리큘럼 관리' : '내 커리큘럼'
  return (
    <div className="lesson-shell">
      {!hideNav && (
        <header className="lesson-shell__header"><BrandLink /><Link to={user ? getRoleHomePath(user.role) : '/'}>← {curriculumLabel}</Link><span>{user?.displayName}</span></header>
      )}
      <main id="lesson-content"><Outlet /></main>
    </div>
  )
}
