import { Navigate, Route, Routes } from 'react-router-dom'
import { instructorPaths, studentPaths } from './paths'
import ScrollToTop from './ScrollToTop'
import GuestOnlyRoute from '@/features/auth/GuestOnlyRoute'
import RequirePasswordChangeRoute from '@/features/auth/RequirePasswordChangeRoute'
import RequireAdminRoute from '@/features/auth/RequireAdminRoute'
import RequireRoleRoute from '@/features/auth/RequireRoleRoute'
import RequireStudentPrejoinRoute from '@/features/live-session/RequireStudentPrejoinRoute'
import NotificationsRedirect from '@/features/notification/NotificationsRedirect'
import InstructorLiveMediaProvider from '@/features/live-session/InstructorLiveMediaProvider'
import CurriculumDetailPage from '@/pages/CurriculumDetailPage'
import CurriculumFormPage from '@/pages/CurriculumFormPage'
import CurriculumListPage from '@/pages/CurriculumListPage'
import CurriculumManagePage from '@/pages/CurriculumManagePage'
import EgressStagePage from '@/pages/EgressStagePage'
import AdminLayout from '@/pages/admin/AdminLayout'
import AdminOverviewPage from '@/pages/admin/AdminOverviewPage'
import AdminSessionDetailPage from '@/pages/admin/AdminSessionDetailPage'
import BrowserPushPromptPreviewPage from '@/pages/BrowserPushPromptPreviewPage'
import EgressAdminPage from '@/pages/admin/EgressAdminPage'
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
import NotificationsPage from '@/pages/NotificationsPage'
import PasswordChangeRequiredPage from '@/pages/PasswordChangeRequiredPage'
import PasswordResetRequestPage from '@/pages/PasswordResetRequestPage'
import ProfilePage from '@/pages/ProfilePage'
import ReplayLessonPage from '@/pages/ReplayLessonPage'
import RecordedLessonEditPage from '@/pages/RecordedLessonEditPage'
import RecordedLessonUploadPage from '@/pages/RecordedLessonUploadPage'
import RecordedLessonDetailPage from '@/pages/RecordedLessonDetailPage'
import RecordedLessonPlaybackPage from '@/pages/RecordedLessonPlaybackPage'
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
        {/*
          임시 비밀번호로 들어온 사람은 이 화면 말고 어디도 갈 수 없다(RequirePasswordChangeRoute).
          그 가드가 이리로 보내므로 이 경로 자체는 가드 밖에 둔다 — 안에 두면 서로를 가리킨다.
        */}
        <Route path="password-change-required" element={<PasswordChangeRequiredPage />} />
        <Route element={<RequirePasswordChangeRoute />}>
        <Route element={<PublicLayout />}>
          <Route index element={<WelcomePage />} />
          <Route path="curriculums" element={<CurriculumListPage />} />
          <Route path="curriculums/:curriculumId" element={<CurriculumDetailPage />} />
          <Route element={<GuestOnlyRoute />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="signup" element={<SignupPage />} />
          </Route>
          {/*
            재설정 흐름은 GuestOnlyRoute에 넣지 않는다. 로그인한 사람도 "현재 비밀번호"를
            기억하지 못하면 비밀번호 변경 폼을 채울 수 없어서, 계정 보안 탭의 링크로 이 화면에
            와야 한다. 게스트 전용으로 묶으면 그 링크가 홈으로 튕긴다.
          */}
          <Route path="password-reset" element={<PasswordResetRequestPage />} />
          {import.meta.env.DEV && (
            <Route path="preview/browser-push-prompt" element={<BrowserPushPromptPreviewPage />} />
          )}
        </Route>
        <Route path="student" element={<RequireRoleRoute role="STUDENT" />}>
          <Route index element={<Navigate to={studentPaths.curriculums} replace />} />
          <Route element={<WorkspaceLayout />}>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
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
            <Route path="lessons/:lessonId/recorded" element={<RecordedLessonPlaybackPage />} />
          </Route>
        </Route>
        {/* 운영 콘솔. 가입 역할과 다른 축이라 별도 트리다 — 화면만 막고, 데이터는 서버가 ROLE_ADMIN으로 막는다. */}
        <Route path="admin" element={<RequireAdminRoute />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="egress" element={<EgressAdminPage />} />
            {/*
              세션 하나의 운영 상세(읽기 전용). 강사 화면으로 링크하지 않는 이유는 ADMIN이 도메인
              게이트를 통과하지 않기 때문이다 — 그쪽은 눌러도 403이다(ADR-0089).
            */}
            <Route path="live-sessions/:sessionId" element={<AdminSessionDetailPage />} />
          </Route>
        </Route>
        <Route path="instructor" element={<RequireRoleRoute role="INSTRUCTOR" />}>
          <Route index element={<Navigate to={instructorPaths.curriculums} replace />} />
          <Route element={<WorkspaceLayout />}>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="curriculums" element={<MyCurriculumsPage />} />
            <Route path="curriculums/new" element={<CurriculumFormPage />} />
            <Route path="curriculums/:curriculumId/manage" element={<CurriculumManagePage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/recorded-lessons/new" element={<RecordedLessonUploadPage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/recorded-lessons/:lessonId/edit" element={<RecordedLessonEditPage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/recorded-lessons/:lessonId" element={<RecordedLessonDetailPage />} />
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
        {/*
          브라우저 푸시가 여는 자리. 서비스워커는 역할을 모르므로 역할 없는 경로로 열고, 여기서
          그 사람의 알림함으로 넘긴다. 이 라우트가 없으면 푸시 클릭이 `*`에 걸려 404가 뜬다.
          레이아웃을 씌우지 않는다 — 리다이렉트뿐이라 헤더가 한 번 깜빡일 이유가 없다.
        */}
        <Route path="notifications" element={<NotificationsRedirect />} />
        <Route path="forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  )
}
