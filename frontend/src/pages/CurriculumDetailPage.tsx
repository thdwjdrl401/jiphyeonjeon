import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import CurriculumHero from '@/features/curriculum/CurriculumHero'
import CurriculumMaterials from '@/features/curriculum/CurriculumMaterials'
import CurriculumNotice from '@/features/curriculum/CurriculumNotice'
import CurriculumOutline from '@/features/curriculum/CurriculumOutline'
import CurriculumOverview from '@/features/curriculum/CurriculumOverview'
import CurriculumDetailSkeleton from '@/features/curriculum-detail/CurriculumDetailSkeleton'
import CurriculumRelationPanel from '@/features/curriculum-detail/CurriculumRelationPanel'
import InstructorManagementCard from '@/features/curriculum-detail/InstructorManagementCard'
import { resolveInstructorManagement } from '@/features/curriculum-detail/instructorManagement'
import { resolvePrimaryAction } from '@/features/curriculum-detail/primaryAction'
import { useCurriculumDetail } from '@/features/curriculum-detail/useCurriculumDetail'
import CurriculumProgress from '@/features/enrollment/CurriculumProgress'
import { useCancelEnrollmentMutation, useEnrollMutation } from '@/features/enrollment/useEnrollmentMutations'
import { ApiError } from '@/shared/api/client'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'

export default function CurriculumDetailPage() {
  const { curriculumId = '' } = useParams()
  const { user, status } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = `${location.pathname}${location.search}`

  const detailQuery = useCurriculumDetail(curriculumId, user ?? undefined, status !== 'loading')
  const enrollMutation = useEnrollMutation(curriculumId)
  const cancelMutation = useCancelEnrollmentMutation(curriculumId)

  usePageTitle(detailQuery.data?.title ?? '커리큘럼 상세')

  if (detailQuery.isPending) {
    return <CurriculumDetailSkeleton />
  }

  if (detailQuery.isError) {
    const error = detailQuery.error
    if (error instanceof ApiError && error.status === 404) {
      return (
        <PageState
          title="커리큘럼을 찾을 수 없어요"
          description="존재하지 않거나 삭제된 커리큘럼이에요."
          action={<Link className="button button--soft" to="/curriculums">커리큘럼 목록으로</Link>}
        />
      )
    }
    return (
      <PageState
        title="커리큘럼을 불러오지 못했어요"
        description="네트워크 연결을 확인한 뒤 다시 시도해 주세요."
        action={<button className="button button--primary" type="button" onClick={() => detailQuery.refetch()}>다시 시도</button>}
      />
    )
  }

  const detail = detailQuery.data
  const primaryAction = resolvePrimaryAction(detail)
  const instructorManagement = resolveInstructorManagement(detail)
  const canViewCurriculumMaterials = ['ENROLLED', 'OWNER_INSTRUCTOR'].includes(detail.viewerContext.relationship)

  const handleEnroll = () => enrollMutation.mutate()
  const handleCancel = () => cancelMutation.mutate()
  const handleManage = () => navigate(instructorPaths.curriculumManage(detail.curriculumId))
  const hasPriorityRelationPanel = ['UNENROLLED_STUDENT', 'PENDING_ENROLLMENT'].includes(
    detail.viewerContext.relationship,
  )
  const relationPanel = (
    <CurriculumRelationPanel
      detail={detail}
      returnTo={returnTo}
      onEnroll={handleEnroll}
      isEnrolling={enrollMutation.isPending}
      onCancel={handleCancel}
      isCancelling={cancelMutation.isPending}
    />
  )

  return (
    <div className={`curriculum-detail-page page-container${user?.role === 'STUDENT' ? ' curriculum-detail-page--student' : ''}`}>
      <div className="curriculum-detail__content">
        <div className="curriculum-detail__main">
          <CurriculumHero
            detail={detail}
            primaryAction={primaryAction}
            onCancel={handleCancel}
            isCancelling={cancelMutation.isPending}
          />

          <CurriculumOutline
            key={detail.curriculumId}
            outline={detail.outline}
            relationship={detail.viewerContext.relationship}
            curriculumId={detail.curriculumId}
          />
        </div>

        <aside className="curriculum-detail__sidebar-track" aria-label="커리큘럼 보조 정보">
          <div className="curriculum-detail__sidebar">
            {instructorManagement && (
              <InstructorManagementCard isInstructor={instructorManagement.isInstructor} onManage={handleManage} />
            )}

            {canViewCurriculumMaterials && detail.materials.length > 0 && (
              <CurriculumMaterials materials={detail.materials} />
            )}

            {detail.viewerContext.relationship === 'ENROLLED' && detail.viewerContext.progress && (
              <CurriculumProgress progress={detail.viewerContext.progress} />
            )}

            {hasPriorityRelationPanel && relationPanel}

            <CurriculumOverview description={detail.description} />

            {!hasPriorityRelationPanel && relationPanel}

            <CurriculumNotice detail={detail} />
          </div>
        </aside>
      </div>
    </div>
  )
}
