import { useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { deleteLesson } from '@/features/curriculum/curriculumManagementService'
import { formatRecordedLessonFileSize } from '@/features/curriculum/recordedLessonUpload'
import { deleteLessonMaterial, getLesson, saveLesson } from '@/features/lesson/lessonService'
import { invalidateAfterLessonWrite } from '@/features/lesson/lessonQueryCache'
import { useRecordedProcessing } from '@/features/recorded-lesson/useRecordedLessonQueries'
import { ApiError } from '@/shared/api/client'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

interface SelectedMaterial {
  id: string
  name: string
  size: string
  file?: File
}

const MAX_MATERIAL_BYTES = 50 * 1024 * 1024
const DELETE_BLOCKING_STATUSES = new Set(['QUEUED', 'TRANSCODING', 'VERIFYING'])

function processingTone(status: string) {
  if (status === 'READY' || status === 'PUBLISHED' || status === 'EMPTY') return 'success' as const
  if (status === 'FAILED') return 'danger' as const
  return 'warning' as const
}

export default function RecordedLessonEditPage() {
  const { curriculumId = '', sectionId = '', lessonId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [materials, setMaterials] = useState<SelectedMaterial[]>([])
  const [materialDragActive, setMaterialDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const lessonQuery = useQuery({
    queryKey: ['recorded-lesson', lessonId, curriculumId, sectionId],
    queryFn: () => getLesson({
      lessonId,
      role: user?.role,
      userId: user?.userId,
      curriculumId,
      sectionId,
    }),
    enabled: Boolean(lessonId && curriculumId && sectionId),
  })
  const lesson = lessonQuery.data
  const isRecordedLesson = lesson?.deliveryType === 'RECORDED'
  const processingQuery = useRecordedProcessing(lessonId, isRecordedLesson)
  const processing = processingQuery.data
  const detailPath = instructorPaths.recordedLesson(curriculumId, sectionId, lessonId)
  const managePath = instructorPaths.curriculumManage(curriculumId)
  const deleteBlocked = Boolean(processing && DELETE_BLOCKING_STATUSES.has(processing.status))

  usePageTitle(`녹화강의 수정 · ${lesson?.title ?? ''}`)

  useEffect(() => {
    if (!lesson) return
    setTitle(lesson.title)
    setDescription(lesson.description)
    setMaterials(lesson.materials.map((material) => ({
      id: material.id,
      name: material.name,
      size: material.size,
    })))
  }, [lesson])

  const addMaterialFiles = (incomingFiles: File[]) => {
    const accepted = incomingFiles.filter((file) => (
      file.name.toLocaleLowerCase().endsWith('.pptx') && file.size <= MAX_MATERIAL_BYTES
    ))
    if (incomingFiles.some((file) => !file.name.toLocaleLowerCase().endsWith('.pptx'))) {
      toast.error('PPTX 파일만 강의 자료로 등록할 수 있습니다.')
    } else if (incomingFiles.some((file) => file.size > MAX_MATERIAL_BYTES)) {
      toast.error('PPTX 강의 자료는 파일당 50MB까지 등록할 수 있습니다.')
    }
    setSubmitError(null)
    setMaterials((current) => {
      const currentIds = new Set(current.map((material) => material.id))
      const additions = accepted
        .map((file) => ({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          size: formatRecordedLessonFileSize(file.size),
          file,
        }))
        .filter((material) => !currentIds.has(material.id))
      return [...current, ...additions]
    })
  }

  const selectMaterials = (event: ChangeEvent<HTMLInputElement>) => {
    addMaterialFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const dropMaterialFiles = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setMaterialDragActive(false)
    addMaterialFiles(Array.from(event.dataTransfer.files))
  }

  const removeMaterial = async (material: SelectedMaterial) => {
    if (!material.file) {
      try {
        await deleteLessonMaterial(lessonId, material.id)
        await invalidateAfterLessonWrite(queryClient, curriculumId, lessonId)
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : '자료를 삭제하지 못했습니다.')
        return
      }
    }
    setMaterials((current) => current.filter((item) => item.id !== material.id))
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || !title.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await saveLesson({
        sectionId,
        lessonId,
        title: title.trim(),
        description: description.trim(),
        materials: materials.flatMap((material) => material.file ? [material.file] : []),
      })
      await invalidateAfterLessonWrite(queryClient, curriculumId, lessonId)
      toast.success('녹화강의 정보를 수정했습니다.')
      navigate(detailPath, { replace: true })
    } catch (error) {
      setSubmitError(error instanceof Error && error.message
        ? error.message
        : '녹화강의 정보를 수정하지 못했습니다. 입력값과 서버 상태를 확인해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const removeLesson = async () => {
    if (deleteBlocked) return
    const confirmed = window.confirm(
      `녹화강의 "${title.trim() || lesson?.title || ''}"을(를) 삭제할까요?\n\n`
        + '· 원본 MP4, HLS 재생본과 자막이 함께 삭제됩니다.\n'
        + '· 강의 자료와 학습 기록도 함께 삭제됩니다.\n\n'
        + '되돌릴 수 없습니다.',
    )
    if (!confirmed) return
    setDeleting(true)
    try {
      await deleteLesson(lessonId)
      await invalidateAfterLessonWrite(queryClient, curriculumId, lessonId)
      toast.success('녹화강의를 삭제했습니다.')
      navigate(managePath, { replace: true })
    } catch (error) {
      toast.error(error instanceof ApiError && error.message
        ? error.message
        : '녹화강의를 삭제하지 못했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  if (!lessonId || !curriculumId || !sectionId) {
    return <PageState title="잘못된 녹화강의 수정 경로입니다" description="강의 식별자를 확인해 주세요." />
  }
  if (lessonQuery.isPending) return <PageState title="녹화강의 정보를 불러오는 중입니다" />
  if (lessonQuery.isError || !lesson) {
    return <PageState title="녹화강의 정보를 불러오지 못했습니다" description="커리큘럼 관리 화면에서 다시 시도해 주세요." />
  }
  if (!isRecordedLesson) {
    return <Navigate to={instructorPaths.editLesson(curriculumId, sectionId, lessonId)} replace />
  }

  return (
    <div className="workspace-page workspace-page--narrow recorded-lesson-edit-page">
      <div className="breadcrumbs">
        <Link to={managePath}>{lesson.curriculumTitle}</Link>
        <span>/</span>
        <span>{lesson.sectionTitle}</span>
        <span>/</span>
        <Link to={detailPath}>{lesson.title}</Link>
        <span>/</span>
        <strong>수정</strong>
      </div>

      <PageHeader
        title="녹화강의 수정"
        description={`${lesson.curriculumTitle} · ${lesson.sectionTitle}`}
        action={<Link className="button button--soft" to={detailPath}>녹화강의 상세로 돌아가기</Link>}
      />

      <form className="workspace-form lesson-form" onSubmit={save}>
        <Panel title="강의 기본 정보" description="수강생에게 표시할 녹화강의 제목과 설명을 수정합니다.">
          <div className="form-grid">
            <label className="form-field--wide">
              <span>강의 제목 *</span>
              <input maxLength={200} value={title} onChange={(event) => { setTitle(event.target.value); setSubmitError(null) }} />
            </label>
            <label className="form-field--wide">
              <span>설명</span>
              <textarea rows={5} value={description} onChange={(event) => { setDescription(event.target.value); setSubmitError(null) }} />
            </label>
          </div>
        </Panel>

        <Panel
          title="녹화 영상"
          description="등록된 원본과 재생 패키지는 녹화강의 상세에서 확인합니다."
          action={processing && (
            <div className="header-action-group">
              <StatusBadge tone={processingTone(processing.status)}>HLS {processing.status}</StatusBadge>
              <StatusBadge tone={processingTone(processing.captionStatus)}>자막 {processing.captionStatus}</StatusBadge>
              <StatusBadge tone={processingTone(processing.recordedPublicationStatus)}>게시 {processing.recordedPublicationStatus}</StatusBadge>
            </div>
          )}
        >
          {processingQuery.isError
            ? <InlineNotice tone="warning">영상 처리 상태를 불러오지 못했습니다. 저장은 가능하며 상세 화면에서 다시 확인할 수 있습니다.</InlineNotice>
            : <InlineNotice tone="info">현재 계약은 업로드가 끝난 원본 영상 교체를 지원하지 않습니다. 처리 확인과 실패 재시도는 녹화강의 상세에서 진행해 주세요.</InlineNotice>}
          <Link className="button button--soft button--small" to={detailPath}>영상 상세 확인</Link>
        </Panel>

        <Panel title="강의 자료" description="PPTX 자료를 추가하거나 기존 자료를 삭제할 수 있습니다.">
          <label
            className={`material-dropzone lesson-form__dropzone${materialDragActive ? ' is-drag-active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setMaterialDragActive(true) }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
            onDragLeave={() => setMaterialDragActive(false)}
            onDrop={dropMaterialFiles}
          >
            <input
              aria-label="녹화강의 자료 파일"
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              multiple
              onChange={selectMaterials}
            />
            <span className="lesson-form__pptx-icon" aria-hidden="true"><span>PPTX</span></span>
            <span className="lesson-form__dropzone-copy">
              <strong>PPTX 파일을 드래그하거나 클릭해 선택</strong>
              <small>여러 파일을 추가할 수 있으며 파일당 최대 50MB입니다.</small>
            </span>
          </label>

          {materials.length > 0 ? (
            <ul className="material-list lesson-form__material-list">
              {materials.map((material) => (
                <li key={material.id}>
                  <span className="file-icon">PPTX</span>
                  <div><strong>{material.name}</strong><small>{material.size}</small></div>
                  {!material.file && <a className="button button--soft button--small" href={`/api/instructor/lessons/${lessonId}/materials/${material.id}/download`} download={material.name}>다운로드</a>}
                  <StatusBadge tone={material.file ? 'warning' : 'success'}>{material.file ? '업로드 대기' : '등록됨'}</StatusBadge>
                  <button type="button" aria-label={`${material.name} 제거`} onClick={() => void removeMaterial(material)}>×</button>
                </li>
              ))}
            </ul>
          ) : <InlineNotice tone="info">등록된 강의 자료가 없습니다.</InlineNotice>}
        </Panel>

        <Panel
          className="lesson-form__panel lesson-form__panel--danger"
          title="녹화강의 삭제"
          description={deleteBlocked
            ? '영상 변환 또는 검증이 진행 중이라 지금은 삭제할 수 없습니다.'
            : '원본 MP4, HLS 재생본, 자막과 강의 자료가 함께 삭제되며 복구할 수 없습니다.'}
          action={(
            <button
              className="button button--ghost button--danger button--small"
              type="button"
              disabled={deleting || deleteBlocked}
              title={deleteBlocked ? '영상 처리가 끝난 뒤 삭제할 수 있습니다.' : undefined}
              onClick={() => void removeLesson()}
            >
              {deleting ? '삭제 중' : '녹화강의 삭제'}
            </button>
          )}
        />

        {submitError && <InlineNotice tone="danger">{submitError}</InlineNotice>}

        <div className="sticky-form-actions lesson-form__actions">
          <Link className="button button--ghost" to={detailPath}>취소</Link>
          <button className="button button--primary button--large" type="submit" disabled={submitting || !title.trim()}>
            {submitting ? '저장 중…' : '녹화강의 수정 저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
