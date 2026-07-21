import { Link, useParams } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { useCurriculumDetail } from '@/features/curriculum-detail/useCurriculumDetail'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export default function LessonLiveUpcomingPage() {
  const { curriculumId = '', lessonId = '' } = useParams()
  const { user } = useAuth()

  const detailQuery = useCurriculumDetail(curriculumId, user ?? undefined)
  const lesson = detailQuery.data?.outline
    .flatMap((section) => section.lessons)
    .find((item) => item.lessonId === lessonId)

  usePageTitle(lesson ? `라이브 준비 중 · ${lesson.title}` : '라이브 준비 중')

  if (detailQuery.isPending) {
    return <PageState compact title="불러오는 중이에요" description="레슨 정보를 확인하고 있어요." />
  }

  const description = lesson?.scheduledAt
    ? `${dateFormatter.format(new Date(lesson.scheduledAt))}에 라이브로 진행돼요. 라이브가 끝나면 다시보기로 제공될 예정이에요.`
    : '아직 라이브 일정이 확정되지 않았어요. 일정이 정해지면 커리큘럼 상세에서 안내해 드릴게요.'

  return (
    <PageState
      title={lesson ? `${lesson.title} · 라이브 준비 중이에요` : '라이브 준비 중이에요'}
      description={description}
      action={<Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼으로 돌아가기</Link>}
    />
  )
}
