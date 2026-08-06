import InstructorProfileDisclosure from './InstructorProfileDisclosure'
import type { CurriculumDetailPeriod, CurriculumInstructorProfile } from './types'

interface CurriculumMetadataProps {
  instructor: CurriculumInstructorProfile
  period: CurriculumDetailPeriod | null
  sectionCount: number
  lessonCount: number
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export default function CurriculumMetadata({
  instructor,
  period,
  sectionCount,
  lessonCount,
}: CurriculumMetadataProps) {
  /*
    날짜 하나를 통째로 묶는다. 묶지 않으면 좁은 칸에서 "2026" / "년 8월 21일"처럼 날짜 중간이
    끊겨 두 줄 어느 쪽도 날짜로 읽히지 않는다. 이렇게 두면 폭이 넉넉할 때는 한 줄로 남고,
    부족할 때만 시작일과 종료일 사이에서 깨진다 — 필요할 때만 두 줄이 되므로 히어로 높이도
    쓸데없이 늘지 않는다.
  */
  const periodLabel = period
    ? (
      <>
        <span className="curriculum-metadata__date">{dateFormatter.format(new Date(period.startsAt))}</span>
        {' – '}
        <span className="curriculum-metadata__date">{dateFormatter.format(new Date(period.endsAt))}</span>
      </>
    )
    : '일정 준비 중'

  return (
    <dl className="curriculum-metadata">
      <div>
        <dt>강사</dt>
        <dd><InstructorProfileDisclosure instructor={instructor} /></dd>
      </div>
      <div>
        <dt>기간</dt>
        <dd>{periodLabel}</dd>
      </div>
      <div>
        <dt>구성</dt>
        <dd>{sectionCount}개 섹션 · {lessonCount}개 강의</dd>
      </div>
    </dl>
  )
}
