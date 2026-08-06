import type { ReactNode } from 'react'
import type { CurriculumDetailResponse } from './types'
import type { PrimaryAction } from '@/features/curriculum-detail/primaryAction'
import CurriculumIdentity from './CurriculumIdentity'
import CurriculumMetadata from './CurriculumMetadata'
import CurriculumPrimaryAction from './CurriculumPrimaryAction'

interface CurriculumHeroProps {
  detail: CurriculumDetailResponse
  primaryAction: PrimaryAction
  onCancel: () => void
  isCancelling: boolean
  reminderControl?: ReactNode
}

const lifecycleLabel: Record<string, string> = {
  DRAFT: '준비 중',
  CLOSED: '운영 종료',
}

export default function CurriculumHero({
  detail,
  primaryAction,
  onCancel,
  isCancelling,
  reminderControl,
}: CurriculumHeroProps) {
  const lifecycleStatus = lifecycleLabel[detail.lifecycleStatus]

  return (
    <section className={`curriculum-hero${detail.thumbnailUrl ? ' curriculum-hero--with-cover' : ''}`}>
      {/*
        대표 이미지는 <b>왼쪽</b> 열에 온다. 오른쪽에 두면 히어로 바로 옆의 사이드바(수강 신청·
        강사 관리·자료 카드)와 붙어 두 덩어리가 한 블록처럼 뭉친다.
        DOM에서도 먼저 둔다 — 시각 순서와 읽는 순서를 어긋나게 하는 grid order를 쓰지 않으려고.

        <p>이미지가 없으면 배너를 만들지 않는다. 목록 카드와 달리 대체 그림을 깔지 않는데,
        히어로는 상세 화면의 첫 면을 통째로 차지해서 뜻 없는 플레이스홀더가 제목·수강 신청보다
        먼저 눈에 들어오기 때문이다. 기간처럼, 이미지를 올리지 않은 커리큘럼이 적지 않다.

        <p>이미지 자체는 장식이다(aria-hidden) — 바로 옆에서 제목과 소개가 같은 것을 말한다.
        목록 카드가 쓰는 방식과 같다.
      */}
      {detail.thumbnailUrl && (
        <div className="curriculum-hero__cover" aria-hidden="true">
          <img src={detail.thumbnailUrl} alt="" />
        </div>
      )}
      <div className="curriculum-hero__body">
        <div className="curriculum-hero__grid">
          <CurriculumIdentity title={detail.title} summary={detail.summary} />
          {(reminderControl || lifecycleStatus) && (
            <div className="curriculum-hero__status">
              {reminderControl}
              {lifecycleStatus && <span className="curriculum-lifecycle-badge">{lifecycleStatus}</span>}
            </div>
          )}
          <CurriculumMetadata
            instructor={detail.instructor}
            period={detail.period}
            sectionCount={detail.outline.length}
            lessonCount={detail.outline.reduce((sum, section) => sum + section.lessons.length, 0)}
          />
          <CurriculumPrimaryAction action={primaryAction} onCancel={onCancel} isCancelling={isCancelling} />
        </div>
      </div>
    </section>
  )
}
