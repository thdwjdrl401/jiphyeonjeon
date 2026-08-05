import { Link, Outlet, useMatch } from 'react-router-dom'
import { getRoleHomePath } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import BrandLink from './BrandLink'

/**
 * 라이브 강의실(classroom)만 이 헤더를 숨긴다.
 *
 * 강의실은 영상 위 "재생 정보" 헤더(호버로 뜨는 오버레이)가 브랜드·돌아가기 버튼을 대신 품는다
 * (PlaybackPlayer·InstructorLiveKitStage 참고) — 화면 위에 두 겹의 헤더를 둘 이유가 없고,
 * 비워진 58px만큼 영상·사이드 패널이 커진다(learning.css `.media-page--live:not(.replay-page)`).
 * 다시보기·녹화강의는 자체 `.media-page__title`이 있어도 브랜드·돌아가기·이름을 담지 않으므로
 * 그대로 이 헤더가 필요하다.
 */
function useIsClassroomRoute() {
  const student = useMatch('/student/live-sessions/:sessionId/classroom')
  const instructor = useMatch('/instructor/live-sessions/:sessionId/classroom')
  return Boolean(student || instructor)
}

export default function LessonLayout() {
  const { user } = useAuth()
  const isClassroom = useIsClassroomRoute()
  const curriculumLabel = user?.role === 'INSTRUCTOR' ? '커리큘럼 관리' : '내 커리큘럼'
  return (
    <div className="lesson-shell">
      {!isClassroom && (
        <header className="lesson-shell__header"><BrandLink /><Link to={user ? getRoleHomePath(user.role) : '/'}>← {curriculumLabel}</Link><span>{user?.displayName}</span></header>
      )}
      <main id="lesson-content"><Outlet /></main>
    </div>
  )
}
