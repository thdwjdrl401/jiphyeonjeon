import { Route, Routes } from 'react-router-dom'
import GuestOnlyRoute from '@/features/auth/GuestOnlyRoute'
import RequireAuthRoute from '@/features/auth/RequireAuthRoute'
import RequireInstructorRoute from '@/features/auth/RequireInstructorRoute'
import CurriculumDetailPage from '@/pages/CurriculumDetailPage'
import CurriculumFormPage from '@/pages/CurriculumFormPage'
import CurriculumListPage from '@/pages/CurriculumListPage'
import CurriculumManagePage from '@/pages/CurriculumManagePage'
import ForbiddenPage from '@/pages/ForbiddenPage'
import InstructorPreflightPage from '@/pages/InstructorPreflightPage'
import LessonDetailPage from '@/pages/LessonDetailPage'
import LessonFormPage from '@/pages/LessonFormPage'
import LiveClassroomPage from '@/pages/LiveClassroomPage'
import LiveSessionDetailPage from '@/pages/LiveSessionDetailPage'
import LiveSessionFormPage from '@/pages/LiveSessionFormPage'
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
      <Route element={<RequireAuthRoute />}>
        <Route element={<WorkspaceLayout />}>
          <Route path="me/profile" element={<ProfilePage />} />
          <Route path="me/curriculums" element={<MyCurriculumsPage />} />
          <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId" element={<LessonDetailPage />} />
          <Route path="live-sessions/:sessionId" element={<LiveSessionDetailPage />} />
          <Route path="live-sessions/:sessionId/prejoin" element={<StudentPrejoinPage />} />
          <Route element={<RequireInstructorRoute />}>
            <Route path="curriculums/new" element={<CurriculumFormPage />} />
            <Route path="curriculums/:curriculumId/manage" element={<CurriculumManagePage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/new" element={<LessonFormPage />} />
            <Route path="curriculums/:curriculumId/sections/:sectionId/lessons/:lessonId/edit" element={<LessonFormPage />} />
            <Route path="instructor/lessons/:lessonId/live-sessions/new" element={<LiveSessionFormPage />} />
            <Route path="instructor/live-sessions/:sessionId/edit" element={<LiveSessionFormPage />} />
            <Route path="instructor/live-sessions/:sessionId/preflight" element={<InstructorPreflightPage />} />
            <Route path="instructor/live-sessions/:sessionId/processing" element={<LiveSessionProcessingPage />} />
          </Route>
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
