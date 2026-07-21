import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import CurriculumImageField from '@/features/curriculum/CurriculumImageField'
import CurriculumMaterialField from '@/features/curriculum/CurriculumMaterialField'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import { demoCurriculum } from '@/features/demo/demoData'
import { buildMockCurriculumOutline, getMockCurriculum, updateMockCurriculumMaterials } from '@/features/demo/mockDatabase'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

interface CurriculumDraftState {
  created?: boolean
  draft?: {
    title: string
    summary: string
    description: string
    startsAt: string
    endsAt: string
    enrollmentType: 'APPROVAL_REQUIRED'
    thumbnailUrl: string | null
    materials: CurriculumMaterial[]
  }
}

type CurriculumInfoField = 'title' | 'summary' | 'description'
type SectionInfoField = 'title' | 'description'

export default function CurriculumManagePage() {
  const { curriculumId = demoCurriculum.curriculumId } = useParams()
  const location = useLocation()
  const routeState = location.state as CurriculumDraftState | null
  const storedCurriculum = getMockCurriculum(curriculumId)
  const isNewDraft = storedCurriculum?.lifecycleStatus === 'DRAFT'
  const [tab, setTab] = useState<'structure' | 'info' | 'enrollees'>('structure')
  const [sections, setSections] = useState(() => storedCurriculum
    ? buildMockCurriculumOutline(storedCurriculum).map((section) => ({
        ...section,
        description: section.description ?? '',
        lessons: section.lessons.map((lesson) => ({
          lessonId: lesson.lessonId,
          title: lesson.title,
          status: lesson.lessonStatus,
        })),
      }))
    : [])
  const [curriculumInfo, setCurriculumInfo] = useState({
    title: routeState?.draft?.title ?? storedCurriculum?.title ?? '',
    summary: routeState?.draft?.summary ?? storedCurriculum?.summary ?? '',
    description: routeState?.draft?.description ?? storedCurriculum?.description ?? '',
  })
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(routeState?.draft?.thumbnailUrl ?? storedCurriculum?.thumbnailUrl ?? null)
  const [materials, setMaterials] = useState<CurriculumMaterial[]>(routeState?.draft?.materials ?? storedCurriculum?.materials ?? [])
  const [saved, setSaved] = useState(Boolean(routeState?.created))
  usePageTitle('커리큘럼 관리')

  const markChanged = () => setSaved(false)

  const updateCurriculumInfo = (field: CurriculumInfoField, value: string) => {
    setCurriculumInfo((current) => ({ ...current, [field]: value }))
    markChanged()
  }

  const updateThumbnail = (value: string | null) => {
    setThumbnailUrl(value)
    markChanged()
  }

  const updateMaterials = (value: CurriculumMaterial[]) => {
    setMaterials(value)
    markChanged()
  }

  const saveChanges = () => {
    updateMockCurriculumMaterials(curriculumId, materials)
    setSaved(true)
  }

  const updateSection = (sectionId: string, field: SectionInfoField, value: string) => {
    setSections((current) => current.map((section) => section.sectionId === sectionId ? { ...section, [field]: value } : section))
    markChanged()
  }

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    setSections((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    markChanged()
  }

  const addSection = () => {
    setSections((current) => [
      ...current,
      {
        sectionId: `sec-${Date.now()}`,
        title: '새 섹션',
        description: '설명을 입력해 주세요.',
        order: current.length + 1,
        lessons: [],
      },
    ])
    markChanged()
  }

  return (
    <div className="workspace-page">
      <PageHeader
        eyebrow="CURRICULUM STUDIO"
        title={curriculumInfo.title || '새 커리큘럼 초안'}
        description="기본 정보, 수강생, 섹션과 레슨 편성을 관리합니다."
        action={<div className="header-action-group"><Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>공개 화면</Link><button className="button button--primary" type="button" onClick={saveChanges}>변경 저장</button></div>}
      />
      {saved && <InlineNotice tone="success">변경 내용이 현재 작업 초안에 반영되었습니다.</InlineNotice>}
      <div className="metric-grid"><MetricCard label="상태" value={storedCurriculum?.lifecycleStatus ?? 'DRAFT'} helper={isNewDraft ? '게시 전' : '운영 중'} /><MetricCard label="섹션" value={sections.length} /><MetricCard label="전체 레슨" value={sections.reduce((sum, section) => sum + section.lessons.length, 0)} /><MetricCard label="수강생" value={storedCurriculum?.enrolleeCount ?? 0} /></div>
      <div className="workspace-tabs" role="tablist"><button className={tab === 'structure' ? 'is-active' : ''} onClick={() => setTab('structure')} type="button">구성</button><button className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')} type="button">기본 정보</button><button className={tab === 'enrollees' ? 'is-active' : ''} onClick={() => setTab('enrollees')} type="button">수강생</button></div>

      {tab === 'structure' && (
        <Panel title="섹션과 레슨" description="섹션 이름과 설명을 바로 수정하고 전체 구조를 함께 저장합니다." action={<button className="button button--soft" type="button" onClick={addSection}>섹션 추가</button>}>
          <div className="structure-list">
            {sections.map((section, sectionIndex) => (
              <article className="structure-section" key={section.sectionId}>
                <header>
                  <div className="drag-handle" aria-hidden="true">⋮⋮</div>
                  <div className="structure-section__fields">
                    <span>SECTION {sectionIndex + 1}</span>
                    <label><small>섹션 이름</small><input aria-label={`섹션 ${sectionIndex + 1} 이름`} maxLength={200} value={section.title} onChange={(event) => updateSection(section.sectionId, 'title', event.target.value)} /></label>
                    <label><small>섹션 설명</small><textarea aria-label={`섹션 ${sectionIndex + 1} 설명`} rows={2} value={section.description} onChange={(event) => updateSection(section.sectionId, 'description', event.target.value)} /></label>
                  </div>
                  <div className="structure-actions"><button aria-label="섹션 위로" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} type="button">↑</button><button aria-label="섹션 아래로" disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} type="button">↓</button><Link className="button button--soft button--small" to={instructorPaths.newLesson(curriculumId, section.sectionId)}>레슨 추가</Link></div>
                </header>
                <ul>{section.lessons.map((lesson, lessonIndex) => <li key={lesson.lessonId}><span className="lesson-order">{lessonIndex + 1}</span><div><strong>{lesson.title}</strong><small>{lesson.status}</small></div><StatusBadge tone={lesson.status === 'PUBLISHED' ? 'success' : lesson.status === 'READY' ? 'warning' : 'neutral'}>{lesson.status}</StatusBadge><div className="row-actions"><Link to={instructorPaths.lesson(curriculumId, section.sectionId, lesson.lessonId)}>상세</Link><Link to={instructorPaths.editLesson(curriculumId, section.sectionId, lesson.lessonId)}>수정</Link></div></li>)}</ul>
              </article>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'info' && (
        <Panel title="기본 정보" description="일반 수정과 공개 상태 전환은 분리합니다.">
          <div className="form-grid"><label className="form-field--wide"><span>제목</span><input value={curriculumInfo.title} onChange={(event) => updateCurriculumInfo('title', event.target.value)} /></label><label className="form-field--wide"><span>짧은 소개</span><input value={curriculumInfo.summary} onChange={(event) => updateCurriculumInfo('summary', event.target.value)} /></label><label className="form-field--wide"><span>상세 설명</span><textarea rows={6} value={curriculumInfo.description} onChange={(event) => updateCurriculumInfo('description', event.target.value)} /></label></div>
          <div className="curriculum-manage-thumbnail"><h3>대표 이미지</h3><p>목록과 상세 카드에 표시할 이미지를 등록합니다.</p><CurriculumImageField id="manage-curriculum-thumbnail" value={thumbnailUrl} onChange={updateThumbnail} /></div>
          <div className="lifecycle-actions"><div><StatusBadge tone="warning">DRAFT</StatusBadge><p>레슨 편성을 확인한 뒤 커리큘럼을 게시하세요.</p></div><button className="button button--primary" type="button" onClick={saveChanges}>커리큘럼 게시</button></div>
          <div className="curriculum-manage-materials"><h3>커리큘럼 강의 자료 <small>선택</small></h3><p>전체 레슨에서 공통으로 제공할 PPTX 자료를 추가하거나 제거합니다.</p><CurriculumMaterialField id="manage-curriculum-materials" value={materials} onChange={updateMaterials} /></div>
        </Panel>
      )}

      {tab === 'enrollees' && <Panel title="수강 신청과 수강생" description="모든 커리큘럼은 강사 승인 후 수강 방식으로 운영합니다."><div className="table-wrap"><table><thead><tr><th>수강생</th><th>신청일</th><th>상태</th><th>진행률</th><th>행동</th></tr></thead><tbody><tr><td>김학생</td><td>2026.07.20</td><td><StatusBadge tone="success">ACTIVE</StatusBadge></td><td>42%</td><td><button className="text-button" type="button">상세</button></td></tr><tr><td>수강생-21B3</td><td>2026.07.21</td><td><StatusBadge tone="warning">PENDING</StatusBadge></td><td>-</td><td><button className="text-button" type="button">승인</button></td></tr></tbody></table></div></Panel>}
    </div>
  )
}
