import { Navigate, Route, Routes } from 'react-router-dom'
import { instructorPaths, studentPaths } from './paths'
import GuestOnlyRoute from '@/features/auth/GuestOnlyRoute'
import RequireRoleRoute from '@/features/auth/RequireRoleRoute'
import RequireStudentPrejoinRoute from '@/features/live-session/RequireStudentPrejoinRoute'
import CurriculumDetailPage from '@/pages/CurriculumDetailPage'
import CurriculumFormPage from '@/pages/CurriculumFormPage'
import CurriculumListPage from '@/pages/CurriculumListPage'
import CurriculumManagePage from '@/pages/CurriculumManagePage'
import ForbiddenPage from '@/pages/ForbiddenPage'
import InstructorPreflightPage from '@/pages/InstructorPreflightPage'
import LessonDetailPage from '@/pages/LessonDetailPage'
import LessonFormPage from '@/pages/LessonFormPage'
import LessonLiveUpcomingPage from '@/pages/LessonLiveUpcomingPage'
import LessonVodPage from '@/pages/LessonVodPage'
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
          <Route path="curriculums/:curriculumId/lessons/:lessonId/vod" element={<LessonVodPage />} />
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
          <Route path="live-sessions/:sessionId/preflight" element={<InstructorPreflightPage />} />
          <Route path="live-sessions/:sessionId/processing" element={<LiveSessionProcessingPage />} />
        </Route>
        <Route element={<LessonLayout />}>
          <Route path="live-sessions/:sessionId/classroom" element={<LiveClassroomPage />} />
          <Route path="lessons/:lessonId/replay" element={<ReplayLessonPage />} />
        </Route>
      </Route>
      <Route path="forbidden" element={<ForbiddenPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
