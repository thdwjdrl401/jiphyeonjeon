import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getInstructorCurriculum } from '@/features/curriculum/curriculumManagementService'
import { deleteLesson } from '@/features/curriculum/curriculumManagementService'
import { deleteLessonMaterial, getLesson, prepareLessonAi, saveLesson } from '@/features/lesson/lessonService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { useToast } from '@/shared/ui/Toast'
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const isEdit = Boolean(lessonId)
  const [deleting, setDeleting] = useState(false)
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
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(existingLiveSession?.scheduledAt))
  const [duration, setDuration] = useState('90')
  const [entryWindow, setEntryWindow] = useState('10')
  const [submitting, setSubmitting] = useState(false)
  /**
   * 강의 삭제. 관리 화면 목록이 아니라 이 화면에만 둔다 — 목록에서는 행마다 삭제 버튼이 있어
   * 한 번의 오클릭으로 강의가 사라졌다. 수정 화면까지 들어온 사람은 대상을 분명히 알고 있다.
   */
  const removeLesson = async () => {
    if (!lessonId) return
    if (!window.confirm(`강의 "${title.trim() || currentLesson?.title || ''}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return
    setDeleting(true)
    try {
      await deleteLesson(lessonId)
      await queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] })
      toast.success('강의를 삭제했습니다.')
      navigate(instructorPaths.curriculumManage(curriculumId))
    } catch {
      toast.error('강의를 삭제하지 못했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  usePageTitle(isEdit ? '강의 수정' : '강의 만들기')

  useEffect(() => {
    if (!currentLesson) return
    setTitle(currentLesson.title)
    setDescription(currentLesson.description)
    setMaterials(currentLesson.materials.map((item) => ({ id: item.id, name: item.name, size: item.size })))
    setScheduledAt(toDateTimeLocal(currentLesson.liveSession?.scheduledAt))
  }, [currentLesson])

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    setMaterials((current) => [...current, ...files.map((file) => ({ id: `${file.name}-${file.lastModified}`, name: file.name, size: `${(file.size / 1024 / 1024).toFixed(1)} MB`, file }))])
  }
  // 저장된 자료(파일 없음 = 서버에 있는 것)는 삭제 API로 즉시 반영, 새로 고른 파일은 로컬에서만 제거.
  const removeMaterial = async (material: SelectedMaterial) => {
    if (!material.file && lessonId) {
      try {
        await deleteLessonMaterial(lessonId, material.id)
      } catch {
        toast.error('자료 삭제에 실패했습니다.')
        return
      }
    }
    setMaterials((current) => current.filter((item) => item.id !== material.id))
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return   // 연타 방지 — 진행 중이면 무시(중복 생성 차단)
    if (!title.trim() || (canEditLiveSchedule && !scheduledAt)) return
    setSubmitting(true)
    try {
      await saveLesson({
        sectionId,
        lessonId,
        title: title.trim(),
        description,
        liveSessionId: existingLiveSession?.sessionId,
        scheduledAt: canEditLiveSchedule && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        entryWindowMinutes: Number(entryWindow),
        expectedDurationMinutes: Number(duration),
        materials: materials.flatMap((material) => material.file ? [material.file] : []),
      })
      toast.success(canEditLiveSchedule ? '강의 정보와 라이브 일정 초안이 저장되었습니다.' : '강의 정보가 저장되었습니다.')
      // 생성 성공 시엔 구성(섹션·강의 목록) 화면으로 돌아간다. 폼을 떠나므로 연타로 매번 새
      // 레슨이 생기던 것도 막힌다. 저장 토스트는 앱 최상단이라 이동 후에도 그대로 보인다.
      if (!isEdit) {
        queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
        queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] })
        navigate(instructorPaths.curriculumManage(curriculumId), { replace: true })
      }
    } catch {
      toast.error('강의 저장에 실패했습니다. 입력값과 서버 상태를 확인해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }
  const prepare = async () => {
    setProcessing(true)
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
        title={isEdit ? '강의 수정' : '새 강의 만들기'}
        description={`${curriculum?.title ?? ''} · ${isEdit ? currentLesson?.sectionTitle ?? '' : '선택한 섹션'}`}
        action={<Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼 상세로 돌아가기</Link>}
      />
      <form className="workspace-form" onSubmit={save}>

        <Panel title="강의 기본 정보" description="강의 제목과 수강생에게 표시할 설명을 입력합니다.">
          <div className="form-grid">
            <label className="form-field--wide"><span>강의 제목 *</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="form-field--wide"><span>설명</span><textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          </div>
        </Panel>

        <Panel title="PPTX 강의 자료" description={isEdit ? '초기 준비 이후에는 자료를 하나씩 추가하고 영향 범위만 다시 처리합니다.' : '초기 자료는 여러 개를 선택한 뒤 한 번에 AI 준비를 시작합니다.'}>
          <label className="material-dropzone"><input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple={!isEdit} onChange={selectFiles} /><span className="material-dropzone__icon">P</span><strong>PPTX 파일 선택</strong><small>{isEdit ? '한 번에 한 파일 · 기존 자료는 유지됩니다.' : '여러 파일을 함께 선택할 수 있습니다.'}</small></label>
          {materials.length > 0 && <ul className="material-list">{materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div>{isEdit && !material.file && <a className="button button--soft button--small" href={`/api/instructor/lessons/${lessonId}/materials/${material.id}/download`}>다운로드</a>}<StatusBadge tone={processing ? 'warning' : 'success'}>{processing ? 'EMBEDDING' : 'READY'}</StatusBadge><button type="button" aria-label={`${material.name} 제거`} onClick={() => void removeMaterial(material)}>×</button></li>)}</ul>}
          <InlineNotice tone={materials.length ? 'info' : 'warning'}>{materials.length ? `${materials.length}개 자료가 준비 목록에 있습니다. AI 준비 중에는 추가·삭제가 제한됩니다.` : '자료가 없어도 강의는 저장됩니다. 라이브 시작 전에 자료를 준비해 주세요.'}</InlineNotice>
          <div className="form-actions"><button className="button button--soft" type="button" disabled={!materials.length || processing} onClick={prepare}>{processing ? 'AI 준비 중…' : 'AI 준비 시작'}</button></div>
        </Panel>

        {canEditLiveSchedule && <Panel title="라이브 강의 일정" description="라이브 강의를 진행할 시각과 입장 조건을 입력합니다. 확정 전 일정은 수강생에게 노출되지 않습니다.">
          <div className="form-grid">
            <label className="form-field--wide"><span>예정 시작 시각 *</span><input required type="datetime-local" value={scheduledAt} onChange={(event) => { setScheduledAt(event.target.value) }} /></label>
            <label><span>예상 진행 시간</span><div className="input-with-unit"><input min="10" max="480" type="number" value={duration} onChange={(event) => { setDuration(event.target.value) }} /><span>분</span></div></label>
            <label><span>입장 가능 창</span><div className="input-with-unit"><input min="0" max="60" type="number" value={entryWindow} onChange={(event) => { setEntryWindow(event.target.value) }} /><span>분 전</span></div></label>
          </div>
        </Panel>}

        {canEditLiveSchedule && <Panel title="항상 적용되는 운영 정책">
          <ul className="policy-list"><li><span>●</span><div><strong>녹화</strong><p>라이브 시작과 함께 Egress HLS 녹화가 시작됩니다.</p></div></li><li><span>CC</span><div><strong>실시간 자막</strong><p>발화가 자막과 AI 근거에 사용됩니다.</p></div></li><li><span>AI</span><div><strong>학습 보조</strong><p>채팅, 개인 질문과 강의 자료가 학습 기능에 연결됩니다.</p></div></li></ul>
          <InlineNotice tone="warning">AI 준비가 끝나지 않으면 일정 저장은 가능하지만 라이브 시작은 차단됩니다.</InlineNotice>
        </Panel>}

        {isEdit && (
          <Panel title="강의 삭제" description="강의와 연결된 라이브 일정·자료가 함께 사라집니다.">
            <div className="curriculum-danger-zone">
              <div>
                <strong>이 강의를 삭제합니다</strong>
                <p>되돌릴 수 없어요. 삭제는 이 화면에서만 할 수 있습니다.</p>
              </div>
              <button className="button button--ghost button--danger" type="button" disabled={deleting} onClick={() => void removeLesson()}>
                {deleting ? '삭제 중' : '강의 삭제'}
              </button>
            </div>
          </Panel>
        )}

        <div className="sticky-form-actions">
          <Link className="button button--ghost" to={isEdit ? lessonDetailPath : publicPaths.curriculum(curriculumId)}>취소</Link>
          <button className="button button--primary button--large" type="submit" disabled={submitting || !title.trim() || (canEditLiveSchedule && !scheduledAt)}>{submitting ? '저장 중…' : isEdit ? '강의 수정 저장' : '강의 생성 저장'}</button>
        </div>
      </form>
    </div>
  )
}
