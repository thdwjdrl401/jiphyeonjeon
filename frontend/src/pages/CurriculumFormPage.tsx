import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import CurriculumAssetsFields from '@/features/curriculum/CurriculumAssetsFields'
import { type CurriculumImageSelection } from '@/features/curriculum/CurriculumImageField'
import CurriculumPeriodFields from '@/features/curriculum/CurriculumPeriodFields'
import { createCurriculum, uploadCurriculumThumbnail } from '@/features/curriculum/curriculumManagementService'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import { ApiError } from '@/shared/api/client'
import { isBeforeToday } from '@/shared/lib/localDateTime'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

/** datetime-local 값("2026-08-01T10:00")을 서버가 받는 오프셋 포함 ISO-8601로. 비어 있으면 null. */
function toIsoOrNull(localValue: string): string | null {
  if (!localValue) return null
  const parsed = new Date(localValue)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export default function CurriculumFormPage() {
  usePageTitle('커리큘럼 만들기')
  const navigate = useNavigate()
  const [form, setForm] = useState({ title: '', summary: '', description: '', startsAt: '', endsAt: '' })
  const [thumbnail, setThumbnail] = useState<CurriculumImageSelection | null>(null)
  const [materials, setMaterials] = useState<CurriculumMaterial[]>([])
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const hasPastEndDate = isBeforeToday(form.endsAt)

  const update = (field: keyof typeof form, value: string) => {
    // 키보드로 과거 날짜를 직접 넣어도 즉시 이유를 알린다. 같은 과거 날짜를 편집하는 동안에는
    // 토스트를 반복하지 않고, 유효한 날짜로 고쳤다가 다시 과거로 바꿀 때만 새로 안내한다.
    if (field === 'endsAt' && isBeforeToday(value) && !hasPastEndDate) {
      toast.error('운영 종료일은 오늘보다 이전일 수 없습니다.')
    }
    setForm((current) => ({ ...current, [field]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // 폼 검증 문구도 토스트로 낸다 — 라이브 강의 폼과 안내 방식을 하나로 맞춘다.
    if (!form.title.trim()) { toast.error('커리큘럼 제목을 입력해 주세요.'); return }
    if (isBeforeToday(form.endsAt)) { toast.error('운영 종료일은 오늘보다 이전일 수 없습니다.'); return }
    if (form.startsAt && form.endsAt && form.startsAt >= form.endsAt) { toast.error('종료일은 시작일보다 뒤여야 합니다.'); return }
    setSubmitting(true)
    try {
      // 이미지는 저장 시점에 올린다 — 폼을 그만두면 아무것도 남지 않도록.
      const thumbnailAssetId = thumbnail ? await uploadCurriculumThumbnail(thumbnail.file) : null
      const { curriculumId, periodSaved } = await createCurriculum({
        title: form.title.trim(),
        summary: form.summary.trim(),
        description: form.description.trim(),
        thumbnailAssetId,
        thumbnailPreviewUrl: thumbnail?.previewUrl ?? null,
        materials,
        startsAt: toIsoOrNull(form.startsAt),
        endsAt: toIsoOrNull(form.endsAt),
      })
      // 초안은 만들어졌는데 기간만 못 붙은 경우 — 조용히 넘기면 입력한 기간이 사라진 걸 모른다.
      if (!periodSaved) {
        toast.error('초안은 만들었지만 운영 기간을 저장하지 못했어요. 기간을 다시 설정해 주세요.')
      }
      // 방금 만든 건 DRAFT라 공개 상세(GET /curriculums/{id}, PUBLISHED-only)로 보내면 404로 튕긴다.
      // 강사 엔드포인트로 읽는 관리 화면으로 보낸다(ADR-0041). created 플래그로 "저장됨" 상태로 시작.
      navigate(instructorPaths.curriculumManage(curriculumId), { state: { created: true } })
    } catch (requestError) {
      toast.error(requestError instanceof ApiError ? requestError.message : '커리큘럼을 만들지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="workspace-page curriculum-form-page">
      <PageHeader title="새 커리큘럼 만들기" description="기본 정보와 운영 설정을 입력해 커리큘럼 초안을 만듭니다." />
      {/*
        noValidate — 종료일 min 위반을 브라우저가 "유효한 값을 입력하세요" 풍선으로 먼저 가로채면
        무엇이 왜 틀렸는지 알 수 없다. 검증은 아래 submit이 맡고 문구는 토스트로 낸다.
      */}
      <form className="workspace-form curriculum-form" onSubmit={submit} noValidate>
        <div className="curriculum-form__top-grid">
          <Panel className="curriculum-form__panel curriculum-form__panel--basic" title="기본 정보" description="제목만 입력해도 초안을 만들 수 있으며 나머지는 나중에 보완할 수 있어요.">
            <div className="form-grid curriculum-form__basic-grid">
              <label><span>제목 *</span><input value={form.title} maxLength={200} placeholder="예: 라이브로 완성하는 Spring Boot" onChange={(event) => update('title', event.target.value)} /><small>{form.title.length}/200</small></label>
              <label><span>짧은 소개</span><input value={form.summary} maxLength={500} placeholder="목록 카드에 표시할 한 줄 소개" onChange={(event) => update('summary', event.target.value)} /></label>
              <label className="form-field--wide"><span>상세 설명</span><textarea rows={4} value={form.description} placeholder="학습 목표, 진행 방식, 추천 대상을 설명해 주세요." onChange={(event) => update('description', event.target.value)} /></label>
            </div>
          </Panel>

          <Panel className="curriculum-form__panel curriculum-form__panel--period" title="운영 기간" description="커리큘럼의 진행 기간과 수강 방식을 설정합니다.">
            <div className="operation-fields">
              <CurriculumPeriodFields
                idPrefix="new-curriculum"
                value={{ startsAt: form.startsAt, endsAt: form.endsAt }}
                onChange={update}
              />
              <InlineNotice tone="info">
                수강은 <strong>강사 승인 후 수강</strong> 방식으로 운영돼요. 학생이 신청하면 승인 대기 상태가 되고,
                강사가 승인해야 수강이 시작됩니다.
              </InlineNotice>
            </div>
          </Panel>
        </div>

        <Panel className="curriculum-form__panel curriculum-form__panel--assets" title="대표 이미지와 강의 자료" description="목록에 표시할 이미지와 커리큘럼 공통 자료를 선택해서 등록합니다.">
          <CurriculumAssetsFields
            idPrefix="new-curriculum"
            thumbnailPreviewUrl={thumbnail?.previewUrl ?? null}
            onThumbnailChange={setThumbnail}
            materials={materials}
            onMaterialsChange={setMaterials}
          />
        </Panel>

        <div className="sticky-form-actions curriculum-form__actions"><Link className="button button--ghost" to={instructorPaths.curriculums}>취소</Link><button className="button button--primary button--large" type="submit" disabled={submitting || hasPastEndDate}>{submitting ? '초안 만드는 중' : '초안 만들기'}</button></div>
      </form>
    </div>
  )
}
