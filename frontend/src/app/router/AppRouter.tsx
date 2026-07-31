import { Navigate, Route, Routes } from 'react-router-dom'
import { instructorPaths, studentPaths } from './paths'
import ScrollToTop from './ScrollToTop'
import GuestOnlyRoute from '@/features/auth/GuestOnlyRoute'
import RequireRoleRoute from '@/features/auth/RequireRoleRoute'
import RequireStudentPrejoinRoute from '@/features/live-session/RequireStudentPrejoinRoute'
import InstructorLiveMediaProvider from '@/features/live-session/InstructorLiveMediaProvider'
import CurriculumDetailPage from '@/pages/CurriculumDetailPage'
import CurriculumFormPage from '@/pages/CurriculumFormPage'
import CurriculumListPage from '@/pages/CurriculumListPage'
import CurriculumManagePage from '@/pages/CurriculumManagePage'
import EgressStagePage from '@/pages/EgressStagePage'
import ForbiddenPage from '@/pages/ForbiddenPage'
import InstructorPreflightPage from '@/pages/InstructorPreflightPage'
import LessonDetailPage from '@/pages/LessonDetailPage'
import LessonFormPage from '@/pages/LessonFormPage'
import LessonLiveUpcomingPage from '@/pages/LessonLiveUpcomingPage'
import LiveClassroomPage from '@/pages/LiveClassroomPage'
import LiveSessionProcessingPage from '@/pages/LiveSessionProcessingPage'
import LoginPage from '@/pages/LoginPage'
import MyCurriculumsPage from '@/pages/MyCurriculumsPage'
import NotFoundPage from '@/pages/NotFoundPage'
import ProfilePage from '@/pages/ProfilePage'
import ReplayLessonPage from '@/pages/ReplayLessonPage'
import SignupPage from '@/pages/SignupPage'
import StudentPrejoinPage from '@/pages/StudentPrejoinPage'
import WelcomePage from '@/pages/WelcomePage'
import LessonLayout from '@/shared/layout/LessonLayout'
import PublicLayout from '@/shared/layout/PublicLayout'
import WorkspaceLayout from '@/shared/layout/WorkspaceLayout'

export default function AppRouter() {
  return (
    <>
      {/* 라우트 이동 시 스크롤 초기화. 라우팅 계층에 한 번만 둔다(페이지별 중복 구현 금지). */}
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<WelcomePage />} />
          <Route path="curriculums" element={<CurriculumListPage />} />
          <Route path="curriculums/:curriculumId" element={<CurriculumDetailPage />} />
          <Route element={<GuestOnlyRoute />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="signup" element={<SignupPage />} />
          </Route>
        </Route>
        <Route path="student" element={<RequireRoleRoute role="STUDENT" />}>
          <Route index element={<Navigate to={studentPaths.curriculums} replace />} />
          <Route element={<WorkspaceLayout />}>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="curriculums" element={<MyCurriculumsPage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId" element={<LessonDetailPage />} />
            <Route path="curriculums/:curriculumId/lessons/:lessonId/live-upcoming" element={<LessonLiveUpcomingPage />} />
            <Route path="live-sessions/:sessionId/prejoin" element={<StudentPrejoinPage />} />
          </Route>
          <Route element={<LessonLayout />}>
            <Route element={<RequireStudentPrejoinRoute />}>
              <Route path="live-sessions/:sessionId/classroom" element={<LiveClassroomPage />} />
            </Route>
            <Route path="lessons/:lessonId/replay" element={<ReplayLessonPage />} />
          </Route>
        </Route>
        <Route path="instructor" element={<RequireRoleRoute role="INSTRUCTOR" />}>
          <Route index element={<Navigate to={instructorPaths.curriculums} replace />} />
          <Route element={<WorkspaceLayout />}>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="curriculums" element={<MyCurriculumsPage />} />
            <Route path="curriculums/new" element={<CurriculumFormPage />} />
            <Route path="curriculums/:curriculumId/manage" element={<CurriculumManagePage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/new" element={<LessonFormPage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId" element={<LessonDetailPage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId/edit" element={<LessonFormPage />} />
            <Route path="live-sessions/:sessionId/processing" element={<LiveSessionProcessingPage />} />
          </Route>
          <Route path="live-sessions/:sessionId" element={<InstructorLiveMediaProvider />}>
            <Route index element={<Navigate to="preflight" replace />} />
            <Route element={<WorkspaceLayout />}>
              <Route path="preflight" element={<InstructorPreflightPage />} />
            </Route>
            <Route element={<LessonLayout />}>
              <Route path="classroom" element={<LiveClassroomPage />} />
            </Route>
          </Route>
          <Route element={<LessonLayout />}>
            <Route path="lessons/:lessonId/replay" element={<ReplayLessonPage />} />
          </Route>
        </Route>
        {/*
          Egress 합성 캔버스. 로그인 가드 밖에 둔다 — 이 페이지를 여는 것은 사람이 아니라
          Egress의 헤드리스 Chrome이고, 브라우저 세션이 없다. 대신 아무 권한도 갖지 않는다:
          방 접속에 필요한 LiveKit 토큰을 Egress가 쿼리로 넘겨줘야만 화면이 그려진다.
          레이아웃(PublicLayout 등)을 씌우지 않는다 — 헤더나 여백이 그대로 녹화된다.
        */}
        <Route path="egress/stage" element={<EgressStagePage />} />
        <Route path="forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
