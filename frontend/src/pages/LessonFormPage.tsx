import { useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getInstructorCurriculum } from '@/features/curriculum/curriculumManagementService'
import { deleteLesson } from '@/features/curriculum/curriculumManagementService'
import { deleteLessonMaterial, getLesson, prepareLessonAi, saveLesson } from '@/features/lesson/lessonService'
import LessonBreadcrumbs from '@/features/lesson/LessonBreadcrumbs'
import { invalidateAfterLessonWrite } from '@/features/lesson/lessonQueryCache'
import { ApiError } from '@/shared/api/client'
import { isBeforeToday, todayLocalStart } from '@/shared/lib/localDateTime'
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
  const curriculumReturnPath = isEdit ? publicPaths.curriculum(curriculumId) : instructorPaths.curriculumManage(curriculumId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [materials, setMaterials] = useState<SelectedMaterial[]>([])
  const [materialDragActive, setMaterialDragActive] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(existingLiveSession?.scheduledAt))
  const [duration, setDuration] = useState('90')
  const [entryWindow, setEntryWindow] = useState('10')
  const [submitting, setSubmitting] = useState(false)
  // error는 폼 검증 전용이다(입력을 고치는 동안 남아 있어야 한다).
  // 저장 실패처럼 한 번 읽고 지나가는 알림은 토스트로 낸다 — CurriculumFormPage와 같은 방식.
  const [error, setError] = useState('')
  const pendingMaterialCount = materials.filter((material) => material.file).length
  /**
   * 강의 삭제. 관리 화면 목록이 아니라 이 화면에만 둔다 — 목록에서는 행마다 삭제 버튼이 있어
   * 한 번의 오클릭으로 강의가 사라졌다. 수정 화면까지 들어온 사람은 대상을 분명히 알고 있다.
   */
  const removeLesson = async () => {
    if (!lessonId) return
    // 녹화가 있으면 영상 파일까지 지운다. 무엇이 사라지는지 적지 않으면 다시보기가 없어질 줄 모르고
    // 누르게 되고, 파일은 복구할 수 없다.
    const confirmed = window.confirm(
      `강의 "${title.trim() || currentLesson?.title || ''}"을(를) 삭제할까요?\n\n`
        + '· 라이브 일정·자료·채팅이 함께 사라집니다.\n'
        + '· 녹화가 있으면 다시보기 영상도 함께 삭제됩니다.\n\n'
        + '되돌릴 수 없습니다.',
    )
    if (!confirmed) return
    setDeleting(true)
    try {
      await deleteLesson(lessonId)
      await invalidateAfterLessonWrite(queryClient, curriculumId)
      toast.success('강의를 삭제했습니다.')
      navigate(instructorPaths.curriculumManage(curriculumId))
    } catch (error) {
      // 서버가 사유를 담아 주면 그대로 보여 준다(수강 상태 변경과 같은 규칙). 사유를 버리면 강사는
      // "왜 안 되는지"를 알 수 없고, 실제로 FK에 막혀 영영 안 지워지던 강의가 그렇게 방치됐다.
      toast.error(error instanceof ApiError && error.message
        ? error.message
        : '강의를 삭제하지 못했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  usePageTitle(isEdit ? '강의 수정' : '강의 만들기')

  useEffect(() => {
    if (!currentLesson) return
    setTitle(currentLesson.title)
    setDescription(currentLesson.description)
    /*
      서버 목록으로 맞추되 아직 저장하지 않은(File 보유) 선택은 남긴다. 저장·자료 삭제가 부르는
      refetch가 이 자리를 지나가는데(ADR-0076), 통째로 덮으면 사용자가 골라 둔 파일이 조용히
      사라진다. 저장에 성공한 파일은 save()가 먼저 로컬에서 떼므로 여기서 중복되지 않는다.
    */
    setMaterials((current) => [
      ...currentLesson.materials.map((item) => ({ id: item.id, name: item.name, size: item.size })),
      ...current.filter((item) => item.file),
    ])
    setScheduledAt(toDateTimeLocal(currentLesson.liveSession?.scheduledAt))
  }, [currentLesson])

  const addMaterialFiles = (incomingFiles: File[]) => {
    const pptxFiles = incomingFiles.filter((file) => file.name.toLowerCase().endsWith('.pptx'))
    if (pptxFiles.length !== incomingFiles.length) toast.error('PPTX 파일만 강의 자료로 등록할 수 있습니다.')
    const filesToAdd = isEdit ? pptxFiles.slice(0, 1) : pptxFiles
    setMaterials((current) => {
      const currentIds = new Set(current.map((material) => material.id))
      const additions = filesToAdd
        .map((file) => ({ id: `${file.name}-${file.lastModified}`, name: file.name, size: `${(file.size / 1024 / 1024).toFixed(1)} MB`, file }))
        .filter((material) => !currentIds.has(material.id))
      return [...current, ...additions]
    })
  }
  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addMaterialFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }
  const dropMaterialFiles = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setMaterialDragActive(false)
    addMaterialFiles(Array.from(event.dataTransfer.files))
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
      // 삭제는 서버에 바로 반영되므로 캐시도 바로 맞춘다 — 안 하면 강의 상세나 폼을 다시 열었을 때
      // 지운 자료가 30초(staleTime) 동안 남아 보인다.
      await invalidateAfterLessonWrite(queryClient, curriculumId, lessonId)
    }
    setMaterials((current) => current.filter((item) => item.id !== material.id))
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return   // 연타 방지 — 진행 중이면 무시(중복 생성 차단)
    if (!title.trim() || (canEditLiveSchedule && !scheduledAt)) return
    setError('')
    // 이미 지난 시각으로 시작하는 라이브는 새로 만들 수 없다. 수정에서는 막지 않는다 —
    // 어제 잡아 둔 라이브의 제목만 고치려던 사람까지 저장이 막히면 안 된다.
    if (canEditLiveSchedule && !isEdit && isBeforeToday(scheduledAt)) {
      setError('라이브 예정일은 오늘보다 이전일 수 없습니다.')
      return
    }
    // noValidate로 넘어온 몫 — 브라우저가 보던 숫자 범위를 여기서 그대로 본다.
    if (canEditLiveSchedule && !(Number(duration) >= 10 && Number(duration) <= 480)) {
      setError('예상 진행 시간은 10분에서 480분 사이여야 합니다.')
      return
    }
    if (canEditLiveSchedule && !(Number(entryWindow) >= 0 && Number(entryWindow) <= 60)) {
      setError('입장 가능 창은 0분에서 60분 사이여야 합니다.')
      return
    }
    setSubmitting(true)
    try {
      const saved = await saveLesson({
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
      // 올린 파일은 이제 서버에 있다 — 로컬의 "업로드 대기" 항목을 떼지 않으면 다시 저장할 때
      // 같은 자료가 한 번 더 업로드·연결된다. 아래 refetch가 실제 materialId로 채워 준다.
      setMaterials((current) => current.filter((material) => !material.file))
      // 저장한 강의 자신도 무효화한다 — 이 폼과 강의 상세가 방금 올린 자료를 바로 보게 한다.
      // await이 refetch까지 기다리므로, 버튼이 다시 눌릴 수 있게 되는 시점엔 목록이 이미 최신이다.
      await invalidateAfterLessonWrite(queryClient, curriculumId, saved.lessonId)
      toast.success(canEditLiveSchedule ? '강의 정보와 라이브 일정이 저장되었습니다.' : '강의 정보가 저장되었습니다.')
      // 생성 성공 시엔 구성(섹션·강의 목록) 화면으로 돌아간다. 폼을 떠나므로 연타로 매번 새
      // 레슨이 생기던 것도 막힌다. 저장 토스트는 앱 최상단이라 이동 후에도 그대로 보인다.
      if (!isEdit) {
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
  if (isEdit && currentLesson?.deliveryType === 'RECORDED') {
    return <Navigate to={instructorPaths.editRecordedLesson(curriculumId, sectionId, currentLesson.lessonId)} replace />
  }

  return (
    <div className="workspace-page workspace-page--narrow lesson-form-page">
      {isEdit && currentLesson && (
        <LessonBreadcrumbs
          curriculumPath={curriculumReturnPath}
          curriculumTitle={curriculum?.title ?? currentLesson.curriculumTitle}
          lessonPath={lessonDetailPath}
          lessonTitle={currentLesson.title}
          sectionTitle={currentLesson.sectionTitle}
        />
      )}
      <PageHeader
        title={isEdit ? '강의 수정' : '새 강의 만들기'}
        description={isEdit ? undefined : `${curriculum?.title ?? ''} · 선택한 섹션`}
        action={isEdit
          ? <Link className="button button--soft" to={lessonDetailPath}>강의 상세로 돌아가기</Link>
          : <Link className="button button--soft" to={curriculumReturnPath}>커리큘럼 관리로 돌아가기</Link>}
      />
      {/*
        noValidate — 예정일 min 위반을 브라우저가 "유효한 값을 입력하세요" 풍선으로 먼저 가로채면
        무엇이 왜 틀렸는지 알 수 없다. 검증은 save가 맡고 문구는 아래 InlineNotice로 낸다.
        브라우저가 보던 숫자 범위 검사도 save로 함께 옮겼다.
      */}
      <form className="workspace-form lesson-form" onSubmit={save} noValidate>
        <div className="lesson-form__top-grid">
          <Panel className="lesson-form__panel lesson-form__panel--basic" title="강의 기본 정보" description="강의 제목과 수강생에게 표시할 설명을 입력합니다.">
            <div className="form-grid">
              <label className="form-field--wide"><span>강의 제목 *</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="form-field--wide"><span>설명</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            </div>

            <div className="lesson-form__embedded-section lesson-form__materials-section">
              <div className="lesson-form__embedded-heading">
                <div className="lesson-form__section-title">
                  <h3>강의 자료</h3>
                  <StatusBadge tone={processing || pendingMaterialCount > 0 ? 'warning' : materials.length ? 'success' : 'neutral'}>
                    {processing ? 'AI 준비 중' : pendingMaterialCount > 0 ? `${materials.length}개 · 준비 필요` : materials.length ? `${materials.length}개 · READY` : '자료 없음'}
                  </StatusBadge>
                </div>
                <div className="lesson-form__material-actions">
                  <button className="button button--soft button--small" type="button" disabled={!materials.length || processing} onClick={prepare}>{processing ? '준비 중…' : 'AI 준비'}</button>
                </div>
              </div>
              <label
                className={`material-dropzone lesson-form__dropzone${materialDragActive ? ' is-drag-active' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setMaterialDragActive(true) }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
                onDragLeave={() => setMaterialDragActive(false)}
                onDrop={dropMaterialFiles}
              >
                <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple={!isEdit} onChange={selectFiles} />
                <span className="lesson-form__pptx-icon" aria-hidden="true"><span>PPTX</span></span>
                <span className="lesson-form__dropzone-copy"><strong>PPTX 파일을 드래그하거나 클릭해 선택</strong><small>{isEdit ? '한 번에 한 파일 · 기존 자료 유지' : '여러 파일 동시 등록 가능'}</small></span>
              </label>
              {materials.length > 0
                ? <ul className="material-list lesson-form__material-list">{materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div>{isEdit && !material.file && <a className="button button--soft button--small" href={`/api/instructor/lessons/${lessonId}/materials/${material.id}/download`}>다운로드</a>}<StatusBadge tone={processing || material.file ? 'warning' : 'success'}>{processing ? 'EMBEDDING' : material.file ? '대기' : 'READY'}</StatusBadge><button type="button" aria-label={`${material.name} 제거`} onClick={() => void removeMaterial(material)}>×</button></li>)}</ul>
                : null}
              {pendingMaterialCount > 0 && !processing && <p className="lesson-form__ai-warning">선택한 자료는 AI 준비를 완료해야 라이브에서 사용할 수 있습니다.</p>}
            </div>
          </Panel>

          {canEditLiveSchedule && <Panel className="lesson-form__panel lesson-form__panel--schedule" title="라이브 강의 일정" description={isEdit ? '라이브를 진행할 시각과 입장 조건입니다.' : '강의 생성에 필요한 필수 일정입니다.'}>
            <div className="form-grid lesson-form__schedule-grid">
              {/* 생성에서만 하한선을 건다 — 수정은 이미 지난 일정을 그대로 둔 채 다른 항목만 고칠 수 있어야 한다. */}
              <label className="form-field--wide"><span>예정 시작 시각 *</span><input required type="datetime-local" value={scheduledAt} min={isEdit ? undefined : todayLocalStart()} onChange={(event) => { setScheduledAt(event.target.value) }} /></label>
              <label><span>예상 진행 시간</span><div className="input-with-unit"><input min="10" max="480" type="number" value={duration} onChange={(event) => { setDuration(event.target.value) }} /><span>분</span></div></label>
              <label><span>입장 가능 창</span><div className="input-with-unit"><input min="0" max="60" type="number" value={entryWindow} onChange={(event) => { setEntryWindow(event.target.value) }} /><span>분 전</span></div></label>
            </div>
          </Panel>}

          {canEditLiveSchedule && <Panel className="lesson-form__panel lesson-form__panel--policy" title="자동 적용 정책" description="라이브 강의에 항상 적용되는 운영 방식입니다.">
            <ul className="policy-list lesson-form__policy-list">
              <li><span>●</span><div><strong>녹화</strong><p>라이브 시작과 함께 Egress HLS 녹화가 시작됩니다.</p></div></li>
              <li><span>CC</span><div><strong>실시간 자막</strong><p>발화가 자막과 AI 근거에 사용됩니다.</p></div></li>
              <li><span>AI</span><div><strong>학습 보조</strong><p>채팅, 개인 질문과 강의 자료가 학습 기능에 연결됩니다.</p></div></li>
            </ul>
            <InlineNotice tone="warning">AI 준비 전에는 일정 저장만 가능하고 라이브 시작은 차단됩니다.</InlineNotice>
          </Panel>}
        </div>

        {isEdit && (
          <Panel
            className="lesson-form__panel lesson-form__panel--danger"
            title="강의 삭제"
            description="라이브 일정·자료·채팅과 다시보기 영상이 함께 삭제되며 복구할 수 없습니다."
            action={(
              <button className="button button--ghost button--danger button--small" type="button" disabled={deleting} onClick={() => void removeLesson()}>
                {deleting ? '삭제 중' : '강의 삭제'}
              </button>
            )}
          />
        )}

        {error && <InlineNotice tone="danger">{error}</InlineNotice>}

        <div className="sticky-form-actions lesson-form__actions">
          <Link className="button button--ghost" to={isEdit ? lessonDetailPath : curriculumReturnPath}>취소</Link>
          <button className="button button--primary button--large" type="submit" disabled={submitting || !title.trim() || (canEditLiveSchedule && !scheduledAt)}>{submitting ? '저장 중…' : isEdit ? '강의 수정 저장' : '강의 생성 저장'}</button>
        </div>
      </form>
    </div>
  )
}
