export interface CurriculumPeriodValue {
  startsAt: string
  endsAt: string
}

interface CurriculumPeriodFieldsProps {
  idPrefix: string
  value: CurriculumPeriodValue
  onChange: (field: keyof CurriculumPeriodValue, value: string) => void
}

const DATE_LABEL = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' })

/** datetime-local 문자열을 사람이 읽는 날짜로. 값이 반쪽이거나 깨졌으면 null. */
function readableDate(localValue: string): string | null {
  if (!localValue) return null
  const parsed = new Date(localValue)
  return Number.isNaN(parsed.getTime()) ? null : DATE_LABEL.format(parsed)
}

/** 시작~종료가 몇 주짜리 과정인지. 기간을 입력하고도 감이 안 오는 걸 막는다. */
function readableSpan({ startsAt, endsAt }: CurriculumPeriodValue): string | null {
  if (!startsAt || !endsAt) return null
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null

  const days = Math.ceil((end.getTime() - start.getTime()) / 86_400_000)
  if (days < 7) return `${days}일 과정`
  return `약 ${Math.round(days / 7)}주 과정`
}

/**
 * 운영 기간 입력. "모집 기간"·"공개 기간"으로 읽히지 않도록 legend·라벨·보조 설명에서
 * 커리큘럼이 진행되는 기간임을 반복해 못 박고, 입력한 값을 문장으로 되읽어 준다.
 */
export default function CurriculumPeriodFields({ idPrefix, value, onChange }: CurriculumPeriodFieldsProps) {
  const startLabel = readableDate(value.startsAt)
  const endLabel = readableDate(value.endsAt)
  const span = readableSpan(value)

  return (
    <fieldset className="curriculum-period-fields">
      <legend>커리큘럼 운영 기간</legend>
      <p className="curriculum-period-fields__hint">
        수강생이 이 커리큘럼으로 학습하는 전체 기간이에요. 수강 신청을 받는 기간이나 개별 강의 공개일과는 별개예요.
      </p>
      <div className="curriculum-period-fields__inputs">
        <label htmlFor={`${idPrefix}-starts-at`}>
          <span>운영 시작일</span>
          <input
            id={`${idPrefix}-starts-at`}
            type="datetime-local"
            value={value.startsAt}
            onChange={(event) => onChange('startsAt', event.target.value)}
          />
        </label>
        <label htmlFor={`${idPrefix}-ends-at`}>
          <span>운영 종료일</span>
          <input
            id={`${idPrefix}-ends-at`}
            type="datetime-local"
            value={value.endsAt}
            onChange={(event) => onChange('endsAt', event.target.value)}
          />
        </label>
      </div>
      {(startLabel ?? endLabel) && (
        <p className="curriculum-period-fields__preview">
          {startLabel ?? '시작일 미정'} <span aria-hidden="true">→</span> {endLabel ?? '종료일 미정'}
          {span && <strong>{span}</strong>}
        </p>
      )}
    </fieldset>
  )
}
