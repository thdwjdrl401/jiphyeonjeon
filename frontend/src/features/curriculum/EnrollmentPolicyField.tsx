import type { CurriculumEnrollmentPolicyType } from './types'

export interface EnrollmentPolicyOption {
  value: CurriculumEnrollmentPolicyType
  label: string
  /** 이 방식을 고르면 학생에게 무슨 일이 일어나는지. 정책 이름만으로는 판단할 수 없다. */
  description: string
}

/**
 * 서버가 커리큘럼별 수강 방식을 받기 시작하면 이 배열에 옵션을 더하고
 * EnrollmentPolicyField에 onChange를 넘기면 그대로 선택형이 된다.
 * 지금은 생성 시 APPROVAL_REQUIRED로 고정된다(InstructorCurriculumService).
 */
export const ENROLLMENT_POLICY_OPTIONS: readonly EnrollmentPolicyOption[] = [
  {
    value: 'APPROVAL_REQUIRED',
    label: '강사 승인 후 수강',
    description: '학생이 신청하면 승인 대기 상태가 되고, 강사가 승인해야 수강이 시작돼요.',
  },
]

interface EnrollmentPolicyFieldProps {
  options?: readonly EnrollmentPolicyOption[]
  value: CurriculumEnrollmentPolicyType
  /** 생략하면 고를 수 없는 고정 정책으로 표시한다. */
  onChange?: (value: CurriculumEnrollmentPolicyType) => void
  name?: string
}

/**
 * 수강 방식. 고를 수 있는 값이 하나뿐이면 라디오 대신 "지금은 이렇게 운영된다"는 사실을 문장으로 알린다
 * — 누를 수 없는 선택지는 고를 수 있다는 기대만 만든다.
 */
export default function EnrollmentPolicyField({
  options = ENROLLMENT_POLICY_OPTIONS,
  value,
  onChange,
  name = 'enrollment-policy',
}: EnrollmentPolicyFieldProps) {
  const selectable = Boolean(onChange) && options.length > 1

  if (!selectable) {
    const fixed = options.find((option) => option.value === value) ?? options[0]
    return (
      <div className="enrollment-policy-field enrollment-policy-field--fixed">
        <span>수강 방식</span>
        <strong>{fixed.label}</strong>
        <small>{fixed.description} 지금은 모든 커리큘럼이 이 방식으로 운영돼요.</small>
      </div>
    )
  }

  return (
    <fieldset className="enrollment-policy-field">
      <legend>수강 방식</legend>
      <p className="enrollment-policy-field__hint">학생이 이 커리큘럼에 등록하는 방법을 정합니다.</p>
      <div className="enrollment-policy-field__options">
        {options.map((option) => (
          <label key={option.value} className="enrollment-policy-field__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange?.(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
