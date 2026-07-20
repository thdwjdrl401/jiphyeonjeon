import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CurriculumImageField from '@/features/curriculum/CurriculumImageField'
import { apiClient, ApiError } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

interface CreateCurriculumResponse { curriculumId: string }

export default function CurriculumFormPage() {
  usePageTitle('커리큘럼 만들기')
  const navigate = useNavigate()
  const [form, setForm] = useState({ title: '', summary: '', description: '', startsAt: '', endsAt: '' })
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('커리큘럼 제목을 입력해 주세요.'); return }
    if (form.startsAt && form.endsAt && form.startsAt >= form.endsAt) { setError('종료일은 시작일보다 뒤여야 합니다.'); return }
    setSubmitting(true)
    try {
      let curriculumId = 'cur_new_draft'
      if (!isMockApiEnabled) {
        const { data } = await apiClient.post<CreateCurriculumResponse>('/instructor/curriculums', {
          title: form.title.trim(),
          summary: form.summary.trim(),
          description: form.description.trim(),
        })
        curriculumId = data.curriculumId
      }
      navigate(`/curriculums/${curriculumId}/manage`, {
        state: {
          created: true,
          draft: {
            ...form,
            title: form.title.trim(),
            summary: form.summary.trim(),
            description: form.description.trim(),
            enrollmentType: 'APPROVAL_REQUIRED',
            thumbnailUrl,
          },
        },
      })
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : '커리큘럼을 만들지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="workspace-page workspace-page--narrow">
      <PageHeader eyebrow="NEW CURRICULUM" title="새 커리큘럼 만들기" description="핵심 정보를 먼저 저장하고 섹션과 레슨은 관리 화면에서 편성합니다." />
      <form className="workspace-form" onSubmit={submit}>
        <Panel title="기본 정보" description="제목만으로 초안을 만들 수 있으며 나머지는 나중에 보완할 수 있어요.">
          <div className="form-grid">
            <label className="form-field--wide"><span>제목 *</span><input value={form.title} maxLength={200} placeholder="예: 라이브로 완성하는 Spring Boot" onChange={(event) => update('title', event.target.value)} /><small>{form.title.length}/200</small></label>
            <label className="form-field--wide"><span>짧은 소개</span><input value={form.summary} maxLength={500} placeholder="목록 카드에 표시할 한 줄 소개" onChange={(event) => update('summary', event.target.value)} /></label>
            <label className="form-field--wide"><span>상세 설명</span><textarea rows={7} value={form.description} placeholder="학습 목표, 진행 방식, 추천 대상을 설명해 주세요." onChange={(event) => update('description', event.target.value)} /></label>
          </div>
        </Panel>

        <Panel title="대표 이미지" description="목록과 상세 화면에서 커리큘럼을 구분하는 이미지입니다.">
          <CurriculumImageField id="new-curriculum-thumbnail" value={thumbnailUrl} onChange={setThumbnailUrl} />
        </Panel>

        <Panel title="운영 정보" description="기간은 서버 상세 계약 확정 후 저장되며 수강은 강사 승인 방식으로 운영합니다.">
          <div className="form-grid">
            <label><span>시작일</span><input type="datetime-local" value={form.startsAt} onChange={(event) => update('startsAt', event.target.value)} /></label>
            <label><span>종료일</span><input type="datetime-local" value={form.endsAt} onChange={(event) => update('endsAt', event.target.value)} /></label>
            <div className="form-field--wide fixed-policy-field"><span>수강 방식</span><strong>강사 승인 후 수강</strong><small>학생의 신청을 강사가 승인하면 수강 상태가 활성화됩니다.</small></div>
          </div>
        </Panel>

        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <div className="sticky-form-actions"><Link className="button button--ghost" to="/me/curriculums">취소</Link><button className="button button--primary button--large" type="submit" disabled={submitting}>{submitting ? '초안 만드는 중' : '초안 만들기'}</button></div>
      </form>
    </div>
  )
}
