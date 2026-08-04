import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import {
  getCurriculumManagementStructure,
  getInstructorCurriculum,
  uploadRecordedLesson,
} from '@/features/curriculum/curriculumManagementService'
import {
  formatRecordedLessonFileSize,
  RECORDED_LESSON_VIDEO_ACCEPT,
  validateRecordedLessonVideo,
} from '@/features/curriculum/recordedLessonUpload'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

interface SelectedMaterial {
  id: string
  name: string
  size: string
  file: File
}

const MAX_MATERIAL_BYTES = 50 * 1024 * 1024

export default function RecordedLessonUploadPage() {
  const { curriculumId = '', sectionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const clientRequestId = useRef(crypto.randomUUID())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [materials, setMaterials] = useState<SelectedMaterial[]>([])
  const [materialDragActive, setMaterialDragActive] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const contextQuery = useQuery({
    queryKey: ['recorded-lesson-upload-context', curriculumId],
    queryFn: async () => {
      const [curriculum, sections] = await Promise.all([
        getInstructorCurriculum(curriculumId),
        getCurriculumManagementStructure(curriculumId),
      ])
      return { curriculum, section: sections.find((section) => section.sectionId === sectionId) ?? null }
    },
    enabled: Boolean(curriculumId && sectionId),
  })

  usePageTitle('녹화강의 업로드')

  // 다른 파일을 선택하면 이전 제출 오류도 함께 지운다. 같은 오류가 남아 새 파일도 실패한 것처럼
  // 보이지 않게 한다.
  const selectVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    const validationError = validateRecordedLessonVideo(file)
    setFileError(validationError)
    setSubmitError(null)
    setVideoFile(validationError ? null : file)
    // 같은 파일을 제거한 뒤 다시 선택해도 change가 발생하도록 input 값을 비운다.
    event.target.value = ''
  }

  const removeVideo = () => {
    setVideoFile(null)
    setFileError(null)
    setSubmitError(null)
  }

  const addMaterialFiles = (incomingFiles: File[]) => {
    const pptxFiles = incomingFiles.filter((file) => (
      file.name.toLowerCase().endsWith('.pptx') && file.size <= MAX_MATERIAL_BYTES
    ))
    if (incomingFiles.some((file) => !file.name.toLowerCase().endsWith('.pptx'))) {
      toast.error('PPTX 파일만 강의 자료로 등록할 수 있습니다.')
    } else if (incomingFiles.some((file) => file.size > MAX_MATERIAL_BYTES)) {
      toast.error('PPTX 강의 자료는 파일당 50MB까지 등록할 수 있습니다.')
    }
    setMaterials((current) => {
      const currentIds = new Set(current.map((material) => material.id))
      const additions = pptxFiles
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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || !title.trim() || !videoFile) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await uploadRecordedLesson({
        clientRequestId: clientRequestId.current,
        curriculumId,
        sectionId,
        title: title.trim(),
        description: description.trim(),
        videoFile,
        materials: materials.map((material) => material.file),
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] }),
        queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] }),
      ])
      toast.success('녹화강의를 업로드했습니다. 영상 처리가 완료되면 재생할 수 있습니다.')
      navigate(instructorPaths.curriculumManage(curriculumId), { replace: true })
    } catch (error) {
      setSubmitError(error instanceof Error && error.message
        ? error.message
        : '녹화강의를 업로드하지 못했습니다. 같은 화면에서 다시 시도하면 기존 강의를 이어서 업로드합니다.')
    } finally {
      setSubmitting(false)
    }
  }

  // 컴포넌트가 다른 커리큘럼/섹션으로 재사용될 때 이전 입력을 들고 가지 않는다.
  useEffect(() => {
    clientRequestId.current = crypto.randomUUID()
    setTitle('')
    setDescription('')
    setVideoFile(null)
    setMaterials([])
    setMaterialDragActive(false)
    setFileError(null)
    setSubmitError(null)
  }, [curriculumId, sectionId])

  if (!curriculumId || !sectionId) return <PageState title="잘못된 녹화강의 업로드 경로입니다" />
  if (contextQuery.isPending) return <PageState title="업로드 화면을 준비하는 중입니다" />
  if (contextQuery.isError || !contextQuery.data?.section) {
    return <PageState title="녹화강의를 추가할 섹션을 찾지 못했습니다" description="커리큘럼 구성 화면에서 다시 시도해 주세요." />
  }

  const { curriculum, section } = contextQuery.data
  const canSubmit = Boolean(title.trim() && videoFile && !fileError && !submitting)

  return (
    <div className="workspace-page workspace-page--narrow recorded-lesson-upload-page">
      <PageHeader
        title="녹화강의 업로드"
        description={`${curriculum.title} · ${section.title}`}
        action={<Link className="button button--soft" to={instructorPaths.curriculumManage(curriculumId)}>구성으로 돌아가기</Link>}
      />

      <form className="workspace-form" onSubmit={submit}>
        <Panel title="강의 기본 정보" description="수강생에게 표시할 녹화강의 제목과 설명을 입력합니다.">
          <div className="form-grid">
            <label className="form-field--wide">
              <span>강의 제목 *</span>
              <input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="form-field--wide">
              <span>설명</span>
              <textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
        </Panel>

        <Panel title="녹화 영상" description="한 강의에 MP4 영상 한 개를 선택할 수 있습니다.">
          <label className="material-dropzone recorded-video-dropzone">
            <input
              aria-label="MP4 영상 파일"
              accept={RECORDED_LESSON_VIDEO_ACCEPT}
              type="file"
              onChange={selectVideo}
            />
            <span className="material-dropzone__icon">MP4</span>
            <strong>{videoFile ? '다른 영상 선택' : 'MP4 영상 선택'}</strong>
            <small>원본 영상은 선택 후 업로드 준비 상태로 등록됩니다.</small>
          </label>

          {fileError && <p className="recorded-upload-error" role="alert">{fileError}</p>}
          {videoFile && (
            <div className="recorded-video-selection" aria-label="선택한 녹화 영상">
              <span className="file-icon recorded-video-file-icon">MP4</span>
              <div>
                <strong>{videoFile.name}</strong>
                <small>{formatRecordedLessonFileSize(videoFile.size)}</small>
              </div>
              <StatusBadge tone="success">선택 완료</StatusBadge>
              <button className="text-button" type="button" onClick={removeVideo}>제거</button>
            </div>
          )}

          <InlineNotice tone="info">업로드가 끝난 영상은 재생용 HLS 변환과 검증을 거친 뒤 재생할 수 있습니다.</InlineNotice>
        </Panel>

        <Panel title="강의 자료" description="녹화강의와 함께 수강생에게 제공할 PPTX 자료를 등록합니다.">
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
              <small>여러 파일을 등록할 수 있으며 자료 없이도 업로드할 수 있습니다.</small>
            </span>
          </label>
          {materials.length > 0 && (
            <ul className="material-list lesson-form__material-list">
              {materials.map((material) => (
                <li key={material.id}>
                  <span className="file-icon">PPTX</span>
                  <div><strong>{material.name}</strong><small>{material.size}</small></div>
                  <StatusBadge tone="warning">업로드 대기</StatusBadge>
                  <button
                    type="button"
                    aria-label={`${material.name} 제거`}
                    onClick={() => setMaterials((current) => current.filter((item) => item.id !== material.id))}
                  >×</button>
                </li>
              ))}
            </ul>
          )}
          <InlineNotice tone="info">첨부한 자료는 녹화 영상과 같은 강의에 연결되며, 수강생이 강의 상세에서 확인할 수 있습니다.</InlineNotice>
        </Panel>

        {submitError && <InlineNotice tone="danger">{submitError}</InlineNotice>}

        <div className="sticky-form-actions">
          <Link className="button button--ghost" to={instructorPaths.curriculumManage(curriculumId)}>취소</Link>
          <button className="button button--primary button--large" type="submit" disabled={!canSubmit}>
            {submitting ? '업로드 중…' : '녹화강의 업로드'}
          </button>
        </div>
      </form>
    </div>
  )
}
