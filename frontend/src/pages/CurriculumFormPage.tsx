import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import CurriculumAssetsFields from '@/features/curriculum/CurriculumAssetsFields'
import { type CurriculumImageSelection } from '@/features/curriculum/CurriculumImageField'
import CurriculumPeriodFields from '@/features/curriculum/CurriculumPeriodFields'
import EnrollmentPolicyField from '@/features/curriculum/EnrollmentPolicyField'
import { createCurriculum, uploadCurriculumThumbnail } from '@/features/curriculum/curriculumManagementService'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import { ApiError } from '@/shared/api/client'
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
  // error는 폼 검증 전용이다(입력을 고치는 동안 남아 있어야 한다).
  // 요청 실패처럼 한 번 읽고 지나가는 알림은 토스트로 낸다.
  const [error, setError] = useState('')
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)

  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('커리큘럼 제목을 입력해 주세요.'); return }
    if (form.startsAt && form.endsAt && form.startsAt >= form.endsAt) { setError('종료일은 시작일보다 뒤여야 합니다.'); return }
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
    <div className="workspace-page workspace-page--narrow">
      <PageHeader title="새 커리큘럼 만들기" description="핵심 정보를 먼저 저장한 뒤 커리큘럼 상세에서 관리 화면으로 이동할 수 있습니다." />
      <form className="workspace-form" onSubmit={submit}>
        <Panel title="기본 정보" description="제목만으로 초안을 만들 수 있으며 나머지는 나중에 보완할 수 있어요.">
          <div className="form-grid">
            <label className="form-field--wide"><span>제목 *</span><input value={form.title} maxLength={200} placeholder="예: 라이브로 완성하는 Spring Boot" onChange={(event) => update('title', event.target.value)} /><small>{form.title.length}/200</small></label>
            <label className="form-field--wide"><span>짧은 소개</span><input value={form.summary} maxLength={500} placeholder="목록 카드에 표시할 한 줄 소개" onChange={(event) => update('summary', event.target.value)} /></label>
            <label className="form-field--wide"><span>상세 설명</span><textarea rows={7} value={form.description} placeholder="학습 목표, 진행 방식, 추천 대상을 설명해 주세요." onChange={(event) => update('description', event.target.value)} /></label>
          </div>
        </Panel>

        <Panel title="대표 이미지와 강의 자료" description="대표 이미지와 커리큘럼 전체에서 공통으로 사용할 선택 자료를 등록합니다.">
          <CurriculumAssetsFields
            idPrefix="new-curriculum"
            thumbnailPreviewUrl={thumbnail?.previewUrl ?? null}
            onThumbnailChange={setThumbnail}
            materials={materials}
            onMaterialsChange={setMaterials}
          />
        </Panel>

        <Panel title="운영 기간과 수강 방식" description="이 커리큘럼이 언제부터 언제까지 진행되고, 학생이 어떻게 등록하는지 정합니다.">
          <div className="operation-fields">
            <CurriculumPeriodFields
              idPrefix="new-curriculum"
              value={{ startsAt: form.startsAt, endsAt: form.endsAt }}
              onChange={update}
            />
            <EnrollmentPolicyField value="APPROVAL_REQUIRED" />
          </div>
        </Panel>

        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <div className="sticky-form-actions"><Link className="button button--ghost" to={instructorPaths.curriculums}>취소</Link><button className="button button--primary button--large" type="submit" disabled={submitting}>{submitting ? '초안 만드는 중' : '초안 만들기'}</button></div>
      </form>
    </div>
  )
}
