import type { CourseDetailProgress } from './types'

interface CurriculumProgressProps {
  progress: CourseDetailProgress
}

export default function CurriculumProgress({ progress }: CurriculumProgressProps) {
  return (
    <section className="curriculum-progress-panel" aria-labelledby="curriculum-progress-heading">
      <h2 id="curriculum-progress-heading">학습 진행률</h2>
      <div className="course-progress">
        <div>
          <span>완료한 레슨</span>
          <strong>{progress.completedLessonCount} / {progress.totalLessonCount}</strong>
        </div>
        <span className="progress-track" aria-hidden="true">
          <span style={{ width: `${progress.progressPercent}%` }} />
        </span>
        <span aria-live="polite">{progress.progressPercent}%</span>
      </div>
    </section>
  )
}
