import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getInstructorCurriculum } from '@/features/curriculum/curriculumManagementService'
import { getLesson, prepareLessonAi, saveLesson } from '@/features/lesson/lessonService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

interface SelectedMaterial { id: string; name: string; size: string; file?: File }

function toDateTimeLocal(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

export default function LessonFormPage() {
  const { curriculumId = '', sectionId = '', lessonId } = useParams()
  const { user } = useAuth()
  const isEdit = Boolean(lessonId)
  const curriculumQuery = useQuery({
    queryKey: ['instructor-curriculum', curriculumId],
    queryFn: () => getInstructorCurriculum(curriculumId),
    enabled: Boolean(curriculumId),
  })
  const lessonQuery = useQuery({
    queryKey: ['instructor-lesson-form', lessonId],
    queryFn: () => getLesson({ lessonId: lessonId!, role: user?.role, userId: user?.userId, curriculumId, sectionId }),
    enabled: isEdit,
  })
  const currentLesson = lessonQuery.data
  const curriculum = curriculumQuery.data
  const existingLiveSession = isEdit ? currentLesson?.liveSession : null
  const liveHasEnded = existingLiveSession?.status === 'ENDING' || existingLiveSession?.status === 'ENDED'
  const replayIsPreparingOrAvailable = currentLesson?.replayStatus === 'DRAFT'
    || currentLesson?.replayStatus === 'READY_FOR_REVIEW'
    || currentLesson?.replayStatus === 'PUBLISHED'
  const canEditLiveSchedule = !isEdit || !(liveHasEnded || replayIsPreparingOrAvailable)
  const lessonDetailPath = instructorPaths.lesson(curriculumId, sectionId, lessonId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [materials, setMaterials] = useState<SelectedMaterial[]>([])
  const [processing, setProcessing] = useState(false)
  const [hasLiveSchedule, setHasLiveSchedule] = useState(Boolean(existingLiveSession))
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(existingLiveSession?.scheduledAt))
  const [duration, setDuration] = useState('90')
  const [entryWindow, setEntryWindow] = useState('10')
  const [saveAsDraft, setSaveAsDraft] = useState(existingLiveSession?.status === 'DRAFT')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  usePageTitle(isEdit ? '강의 수정' : '강의 만들기')

  useEffect(() => {
    if (!currentLesson) return
    setTitle(currentLesson.title)
    setDescription(currentLesson.description)
    setMaterials(currentLesson.materials.map((item) => ({ id: item.id, name: item.name, size: item.size })))
    setHasLiveSchedule(Boolean(currentLesson.liveSession))
    setScheduledAt(toDateTimeLocal(currentLesson.liveSession?.scheduledAt))
    setSaveAsDraft(currentLesson.liveSession?.status === 'DRAFT')
  }, [currentLesson])

  const markChanged = () => setSaved(false)
  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    setMaterials((current) => [...current, ...files.map((file) => ({ id: `${file.name}-${file.lastModified}`, name: file.name, size: `${(file.size / 1024 / 1024).toFixed(1)} MB`, file }))])
    markChanged()
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || (canEditLiveSchedule && hasLiveSchedule && !scheduledAt)) return
    setSaveError('')
    try {
      await saveLesson({
        sectionId,
        lessonId,
        title: title.trim(),
        description,
        liveSessionId: existingLiveSession?.sessionId,
        scheduledAt: canEditLiveSchedule && hasLiveSchedule ? new Date(scheduledAt).toISOString() : undefined,
        entryWindowMinutes: Number(entryWindow),
        expectedDurationMinutes: Number(duration),
        materials: materials.flatMap((material) => material.file ? [material.file] : []),
      })
      setSaved(true)
    } catch {
      setSaveError('강의 저장에 실패했습니다. 입력값과 서버 상태를 확인해 주세요.')
    }
  }
  const prepare = async () => {
    setProcessing(true)
    markChanged()
    try {
      await prepareLessonAi(lessonId ?? 'new')
    } finally {
      setProcessing(false)
    }
  }

  if (!curriculumId || !sectionId) return <PageState title="잘못된 강의 경로입니다" />
  if (curriculumQuery.isPending || (isEdit && lessonQuery.isPending)) return <PageState title="강의 정보를 불러오는 중입니다" />
  if (curriculumQuery.isError || (isEdit && (lessonQuery.isError || !currentLesson))) return <PageState title="강의 정보를 불러오지 못했습니다" />

  return (
    <div className="workspace-page workspace-page--narrow">
      <PageHeader
        eyebrow={isEdit ? 'EDIT LESSON' : 'NEW LESSON'}
        title={isEdit ? '강의 수정' : '새 강의 만들기'}
        description={`${curriculum?.title ?? ''} · ${isEdit ? currentLesson?.sectionTitle ?? '' : '선택한 섹션'}`}
        action={<Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼 상세로 돌아가기</Link>}
      />
      <form className="workspace-form" onSubmit={save}>
        {saved && <InlineNotice tone="success">{canEditLiveSchedule ? '강의 정보와 라이브 일정 초안이 저장되었습니다.' : '강의 정보가 저장되었습니다.'}</InlineNotice>}
        {saveError && <InlineNotice tone="danger">{saveError}</InlineNotice>}

        <Panel title="강의 기본 정보" description="강의 제목과 수강생에게 표시할 설명을 입력합니다.">
          <div className="form-grid">
            <label className="form-field--wide"><span>강의 제목 *</span><input value={title} maxLength={200} onChange={(event) => { setTitle(event.target.value); markChanged() }} /></label>
            <label className="form-field--wide"><span>설명</span><textarea rows={5} value={description} onChange={(event) => { setDescription(event.target.value); markChanged() }} /></label>
          </div>
        </Panel>

        <Panel title="PPTX 강의 자료" description={isEdit ? '초기 준비 이후에는 자료를 하나씩 추가하고 영향 범위만 다시 처리합니다.' : '초기 자료는 여러 개를 선택한 뒤 한 번에 AI 준비를 시작합니다.'}>
          <label className="material-dropzone"><input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple={!isEdit} onChange={selectFiles} /><span className="material-dropzone__icon">P</span><strong>PPTX 파일 선택</strong><small>{isEdit ? '한 번에 한 파일 · 기존 자료는 유지됩니다.' : '여러 파일을 함께 선택할 수 있습니다.'}</small></label>
          {materials.length > 0 && <ul className="material-list">{materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><StatusBadge tone={processing ? 'warning' : 'success'}>{processing ? 'EMBEDDING' : 'READY'}</StatusBadge><button type="button" aria-label={`${material.name} 제거`} onClick={() => { setMaterials((current) => current.filter((item) => item.id !== material.id)); markChanged() }}>×</button></li>)}</ul>}
          <InlineNotice tone={materials.length ? 'info' : 'warning'}>{materials.length ? `${materials.length}개 자료가 준비 목록에 있습니다. AI 준비 중에는 추가·삭제가 제한됩니다.` : '자료 없이도 DRAFT 저장은 가능하지만 게시와 라이브 시작은 할 수 없습니다.'}</InlineNotice>
          <div className="form-actions"><button className="button button--soft" type="button" disabled={!materials.length || processing} onClick={prepare}>{processing ? 'AI 준비 중…' : 'AI 준비 시작'}</button></div>
        </Panel>

        {canEditLiveSchedule && <Panel title="라이브 강의 일정" description="라이브 강의를 진행할 강의에만 일정을 설정합니다.">
          <label className="choice-row">
            <input type="checkbox" checked={hasLiveSchedule} onChange={(event) => { setHasLiveSchedule(event.target.checked); markChanged() }} />
            <span><strong>라이브 강의 일정 설정</strong><small>일정이 없는 강의는 강의 상세에서 강의 수정을 통해 추가할 수 있습니다.</small></span>
          </label>
          {hasLiveSchedule && <>
            <div className="form-grid live-schedule-fields">
              <label className="form-field--wide"><span>예정 시작 시각 *</span><input required type="datetime-local" value={scheduledAt} onChange={(event) => { setScheduledAt(event.target.value); markChanged() }} /></label>
              <label><span>예상 진행 시간</span><div className="input-with-unit"><input min="10" max="480" type="number" value={duration} onChange={(event) => { setDuration(event.target.value); markChanged() }} /><span>분</span></div></label>
              <label><span>입장 가능 창</span><div className="input-with-unit"><input min="0" max="60" type="number" value={entryWindow} onChange={(event) => { setEntryWindow(event.target.value); markChanged() }} /><span>분 전</span></div></label>
            </div>
            <label className="choice-row"><input type="checkbox" checked={saveAsDraft} onChange={(event) => { setSaveAsDraft(event.target.checked); markChanged() }} /><span><strong>일정 초안으로 저장</strong><small>확정 전에는 수강생에게 노출하지 않습니다.</small></span></label>
          </>}
        </Panel>}

        {canEditLiveSchedule && hasLiveSchedule && <Panel title="항상 적용되는 운영 정책">
          <ul className="policy-list"><li><span>●</span><div><strong>녹화</strong><p>라이브 시작과 함께 Egress HLS 녹화가 시작됩니다.</p></div></li><li><span>CC</span><div><strong>실시간 자막</strong><p>발화가 자막과 AI 근거에 사용됩니다.</p></div></li><li><span>AI</span><div><strong>학습 보조</strong><p>채팅, 개인 질문과 강의 자료가 학습 기능에 연결됩니다.</p></div></li></ul>
          <InlineNotice tone="warning">강의가 게시되지 않았거나 AI 준비가 끝나지 않으면 일정 저장은 가능하지만 라이브 시작은 차단됩니다.</InlineNotice>
        </Panel>}

        <div className="sticky-form-actions">
          <Link className="button button--ghost" to={isEdit ? lessonDetailPath : publicPaths.curriculum(curriculumId)}>취소</Link>
          <button className="button button--primary button--large" type="submit" disabled={!title.trim() || (canEditLiveSchedule && hasLiveSchedule && !scheduledAt)}>{isEdit ? '강의 수정 저장' : '강의 생성 저장'}</button>
        </div>
      </form>
    </div>
  )
}
