import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { demoCurriculum, demoSections } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function CurriculumManagePage() {
  const { curriculumId = demoCurriculum.curriculumId } = useParams()
  const location = useLocation()
  const [tab, setTab] = useState<'structure' | 'info' | 'enrollees'>('structure')
  const [sections, setSections] = useState(demoSections)
  const [saved, setSaved] = useState(Boolean((location.state as { created?: boolean } | null)?.created))
  usePageTitle('커리큘럼 관리')

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    setSections((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
    setSaved(false)
  }

  return (
    <div className="workspace-page">
      <PageHeader eyebrow="CURRICULUM STUDIO" title={curriculumId === 'cur_new_draft' ? '새 커리큘럼 초안' : demoCurriculum.title} description="기본 정보, 수강생, 섹션과 레슨 편성을 관리합니다." action={<div className="header-action-group"><Link className="button button--soft" to={`/curriculums/${curriculumId}`}>공개 화면</Link><button className="button button--primary" type="button" onClick={() => setSaved(true)}>변경 저장</button></div>} />
      {saved && <InlineNotice tone="success">변경 내용이 현재 작업 초안에 반영되었습니다.</InlineNotice>}
      <div className="metric-grid"><MetricCard label="상태" value="DRAFT" helper="게시 전" /><MetricCard label="섹션" value={sections.length} /><MetricCard label="전체 레슨" value={sections.reduce((sum, section) => sum + section.lessons.length, 0)} /><MetricCard label="수강생" value={demoCurriculum.enrolleeCount} /></div>
      <div className="workspace-tabs" role="tablist"><button className={tab === 'structure' ? 'is-active' : ''} onClick={() => setTab('structure')} type="button">구성</button><button className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')} type="button">기본 정보</button><button className={tab === 'enrollees' ? 'is-active' : ''} onClick={() => setTab('enrollees')} type="button">수강생</button></div>

      {tab === 'structure' && <Panel title="섹션과 레슨" description="순서 변경은 전체 구조를 한 번에 저장하는 방식으로 준비했습니다." action={<button className="button button--soft" type="button" onClick={() => { setSections((current) => [...current, { sectionId: `sec_${Date.now()}`, title: '새 섹션', description: '설명을 입력해 주세요.', lessons: [] }]); setSaved(false) }}>섹션 추가</button>}>
        <div className="structure-list">{sections.map((section, sectionIndex) => <article className="structure-section" key={section.sectionId}><header><div className="drag-handle" aria-hidden="true">⋮⋮</div><div><span>SECTION {sectionIndex + 1}</span><h3>{section.title}</h3><p>{section.description}</p></div><div className="structure-actions"><button aria-label="섹션 위로" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} type="button">↑</button><button aria-label="섹션 아래로" disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} type="button">↓</button><Link className="button button--soft button--small" to={`/curriculums/${curriculumId}/sections/${section.sectionId}/lessons/new`}>레슨 추가</Link></div></header><ul>{section.lessons.map((lesson, lessonIndex) => <li key={lesson.lessonId}><span className="lesson-order">{lessonIndex + 1}</span><div><strong>{lesson.title}</strong><small>{lesson.status}</small></div><StatusBadge tone={lesson.status === 'PUBLISHED' ? 'success' : lesson.status === 'READY' ? 'warning' : 'neutral'}>{lesson.status}</StatusBadge><div className="row-actions"><Link to={`/curriculums/${curriculumId}/sections/${section.sectionId}/lessons/${lesson.lessonId}`}>상세</Link><Link to={`/curriculums/${curriculumId}/sections/${section.sectionId}/lessons/${lesson.lessonId}/edit`}>수정</Link></div></li>)}</ul></article>)}</div>
      </Panel>}

      {tab === 'info' && <Panel title="기본 정보" description="일반 수정과 공개 상태 전환은 분리합니다."><div className="form-grid"><label className="form-field--wide"><span>제목</span><input defaultValue={demoCurriculum.title} /></label><label className="form-field--wide"><span>짧은 소개</span><input defaultValue={demoCurriculum.summary} /></label><label className="form-field--wide"><span>상세 설명</span><textarea rows={6} defaultValue={demoCurriculum.description} /></label></div><div className="lifecycle-actions"><div><StatusBadge tone="warning">DRAFT</StatusBadge><p>레슨 편성을 확인한 뒤 커리큘럼을 게시하세요.</p></div><button className="button button--primary" type="button" onClick={() => setSaved(true)}>커리큘럼 게시</button></div></Panel>}

      {tab === 'enrollees' && <Panel title="수강 신청과 수강생" description="승인·거절·권한 회수 정책 확정 전의 운영 UI 초안입니다."><div className="table-wrap"><table><thead><tr><th>수강생</th><th>신청일</th><th>상태</th><th>진행률</th><th>행동</th></tr></thead><tbody><tr><td>김학생</td><td>2026.07.20</td><td><StatusBadge tone="success">ACTIVE</StatusBadge></td><td>42%</td><td><button className="text-button" type="button">상세</button></td></tr><tr><td>수강생-21B3</td><td>2026.07.21</td><td><StatusBadge tone="warning">PENDING</StatusBadge></td><td>-</td><td><button className="text-button" type="button">승인</button></td></tr></tbody></table></div></Panel>}
    </div>
  )
}
