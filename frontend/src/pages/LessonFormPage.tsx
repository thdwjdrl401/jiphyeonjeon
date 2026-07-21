import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import { demoCurriculum, demoLesson, getDemoLesson } from '@/features/demo/demoData'
import { getMockCurriculum } from '@/features/demo/mockDatabase'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

interface SelectedMaterial { id: string; name: string; size: string }

export default function LessonFormPage() {
  const { curriculumId = demoCurriculum.curriculumId, sectionId = 'sec-security', lessonId } = useParams()
  const isEdit = Boolean(lessonId)
  const currentLesson = getDemoLesson(lessonId ?? demoLesson.lessonId)
  const curriculum = getMockCurriculum(curriculumId)
  const navigate = useNavigate()
  const [title, setTitle] = useState(isEdit ? currentLesson.title : '')
  const [description, setDescription] = useState(isEdit ? currentLesson.description : '')
  const [materials, setMaterials] = useState<SelectedMaterial[]>(isEdit ? currentLesson.materials.map((item) => ({ id: item.id, name: item.name, size: item.size })) : [])
  const [processing, setProcessing] = useState(false)
  const [saved, setSaved] = useState(false)
  usePageTitle(isEdit ? '레슨 수정' : '레슨 만들기')

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    setMaterials((current) => [...current, ...files.map((file) => ({ id: `${file.name}-${file.lastModified}`, name: file.name, size: `${(file.size / 1024 / 1024).toFixed(1)} MB` }))])
  }
  const save = (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; setSaved(true) }
  const prepare = () => { setProcessing(true); window.setTimeout(() => setProcessing(false), 700) }

  return (
    <div className="workspace-page workspace-page--narrow">
      <PageHeader eyebrow={isEdit ? 'EDIT LESSON' : 'NEW LESSON'} title={isEdit ? '레슨 수정' : '새 레슨 만들기'} description={`${curriculum?.title ?? demoCurriculum.title} · ${isEdit ? currentLesson.sectionTitle : '선택한 섹션'}`} action={<Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼 상세로 돌아가기</Link>} />
      <form className="workspace-form" onSubmit={save}>
        <Panel title="레슨 기본 정보" description="기본 정보 저장과 자료 AI 준비는 서로 독립적으로 처리합니다."><div className="form-grid"><label className="form-field--wide"><span>레슨 제목 *</span><input value={title} maxLength={200} onChange={(event) => { setTitle(event.target.value); setSaved(false) }} /></label><label className="form-field--wide"><span>설명</span><textarea rows={5} value={description} onChange={(event) => { setDescription(event.target.value); setSaved(false) }} /></label></div>{saved && <InlineNotice tone="success">레슨 기본 정보가 작업 초안에 저장되었습니다.</InlineNotice>}<div className="form-actions"><button className="button button--primary" type="submit" disabled={!title.trim()}>기본 정보 저장</button></div></Panel>
        <Panel title="PPTX 강의 자료" description={isEdit ? '초기 준비 이후에는 자료를 하나씩 추가하고 영향 범위만 다시 처리합니다.' : '초기 자료는 여러 개를 선택한 뒤 한 번에 AI 준비를 시작합니다.'}>
          <label className="material-dropzone"><input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple={!isEdit} onChange={selectFiles} /><span className="material-dropzone__icon">P</span><strong>PPTX 파일 선택</strong><small>{isEdit ? '한 번에 한 파일 · 기존 자료는 유지됩니다.' : '여러 파일을 함께 선택할 수 있습니다.'}</small></label>
          {materials.length > 0 && <ul className="material-list">{materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><StatusBadge tone={processing ? 'warning' : 'success'}>{processing ? 'EMBEDDING' : 'READY'}</StatusBadge><button type="button" aria-label={`${material.name} 제거`} onClick={() => setMaterials((current) => current.filter((item) => item.id !== material.id))}>×</button></li>)}</ul>}
          <InlineNotice tone={materials.length ? 'info' : 'warning'}>{materials.length ? `${materials.length}개 자료가 준비 목록에 있습니다. AI 준비 중에는 추가·삭제가 제한됩니다.` : '자료 없이도 DRAFT 저장은 가능하지만 게시와 라이브 시작은 할 수 없습니다.'}</InlineNotice>
          <div className="form-actions"><button className="button button--soft" type="button" disabled={!materials.length || processing} onClick={prepare}>{processing ? 'AI 준비 중…' : 'AI 준비 시작'}</button><button className="button button--primary" type="button" disabled={!title.trim()} onClick={() => navigate(instructorPaths.lesson(curriculumId, sectionId, lessonId ?? 'les-new-draft'))}>레슨 상세로</button></div>
        </Panel>
      </form>
    </div>
  )
}
