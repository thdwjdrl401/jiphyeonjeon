import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { useCurriculumDetail } from '@/features/curriculum-detail/useCurriculumDetail'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'

function formatDuration(durationMs: number) {
  const totalMinutes = Math.round(durationMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:00` : `${minutes}:00`
}

export default function LessonVodPage() {
  const { curriculumId = '', lessonId = '' } = useParams()
  const { user } = useAuth()
  const [playing, setPlaying] = useState(false)

  const detailQuery = useCurriculumDetail(curriculumId, user ?? undefined)
  const lesson = detailQuery.data?.outline
    .flatMap((section) => section.lessons)
    .find((item) => item.lessonId === lessonId)

  usePageTitle(lesson ? `다시보기 · ${lesson.title}` : '다시보기')

  if (detailQuery.isPending) {
    return <div className="media-page" />
  }

  if (!lesson) {
    return (
      <PageState
        title="다시보기를 찾을 수 없어요"
        description="레슨 정보를 확인할 수 없거나 아직 다시보기가 준비되지 않았어요."
        action={<Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼으로 돌아가기</Link>}
      />
    )
  }

  return (
    <div className="media-page">
      <header className="media-page__title">
        <div>
          <StatusBadge tone="success">REPLAY</StatusBadge>
          <h1>{lesson.title}</h1>
          <small>{lesson.order}강 · 다시보기</small>
        </div>
        <div className="media-page__status">
          <Link className="button button--soft button--small" to={publicPaths.curriculum(curriculumId)}>커리큘럼으로</Link>
        </div>
      </header>
      <div className="video-stage replay-video">
        <button
          className="play-button"
          type="button"
          aria-label={playing ? '일시정지' : '재생'}
          onClick={() => setPlaying((current) => !current)}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
      </div>
      <div className="replay-controls">
        <div className="timeline-row">
          <span>00:00</span>
          <input
            aria-label="다시보기 타임라인"
            min="0"
            max="100"
            type="range"
            defaultValue={lesson.learning?.progressPercent ?? 0}
          />
          <span>{lesson.durationMs ? formatDuration(lesson.durationMs) : '--:--'}</span>
        </div>
      </div>
    </div>
  )
}
