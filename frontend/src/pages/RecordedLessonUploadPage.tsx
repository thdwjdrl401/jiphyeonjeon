import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import {
  getCurriculumManagementStructure,
  getInstructorCurriculum,
  getRecordedVideoCapabilities,
  uploadRecordedLesson,
} from '@/features/curriculum/curriculumManagementService'
import {
  formatRecordedLessonFileSize,
  recordedUploadLockReason,
  RECORDED_LESSON_VIDEO_ACCEPT,
  validateRecordedLessonVideo,
} from '@/features/curriculum/recordedLessonUpload'
import type { RecordedUploadProgress } from '@/features/curriculum/curriculumManagementService.interface'
import UploadProgressNotice from '@/features/material/UploadProgressNotice'
import { recordedUploadLabel } from '@/features/material/uploadProgressLabel'
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
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('')
  const [materials, setMaterials] = useState<SelectedMaterial[]>([])
  const [materialDragActive, setMaterialDragActive] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /*
   * 이미 <b>연결까지 끝난</b> 자료. 재시도에서 건너뛴다.
   *
   * <p>업로드는 ①레슨 생성 ②자료 ③영상 PUT 순인데, 5GiB가 오가는 ③이 가장 흔한 실패 지점이다.
   * 그때 ②를 처음부터 다시 돌면 같은 PPTX가 두 번 붙고, 그때마다 수강생 전원에게 자료 알림이
   * 다시 나간다. 레슨은 clientRequestId로 멱등인데 자료는 아니라서 생기는 어긋남이다.
   */
  const linkedMaterialIds = useRef(new Set<string>())
  const [progress, setProgress] = useState<RecordedUploadProgress | null>(null)

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

  /*
   * 기능 스위치는 <b>폼을 열 때</b> 묻는다. 예전에는 강사가 제목·5GiB 영상·자료를 다 채우고
   * 제출한 뒤에야 503으로 막혔고, 그때는 ①레슨 생성이 이미 끝난 뒤라 영상 없는 강의가 커리큘럼에
   * 남았다(멱등키는 같은 화면 재시도만 지킨다 — 나갔다 들어오면 새로 하나 더 생긴다).
   *
   * <p>커리큘럼과 별개 축이라 별도 query로 둔다. 실패해도 폼을 막지 않는다 — 아래 잠금은
   * 안내이고, 진짜 차단은 서버가 계속 한다.
   */
  const capabilitiesQuery = useQuery({
    queryKey: ['recorded-video-capabilities'],
    queryFn: getRecordedVideoCapabilities,
  })
  const lockReason = recordedUploadLockReason(capabilitiesQuery.data)

  usePageTitle('녹화강의 업로드')

  useEffect(() => {
    if (!videoFile) {
      setVideoPreviewUrl('')
      return undefined
    }
    const objectUrl = URL.createObjectURL(videoFile)
    setVideoPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [videoFile])

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
    // 둘을 함께 떨어뜨렸으면 둘 다 말한다 — 하나만 알리면 나머지가 왜 빠졌는지 알 수 없다.
    if (incomingFiles.some((file) => !file.name.toLowerCase().endsWith('.pptx'))) {
      toast.error('PPTX 파일만 강의 자료로 등록할 수 있습니다.')
    }
    if (incomingFiles.some((file) => file.name.toLowerCase().endsWith('.pptx') && file.size > MAX_MATERIAL_BYTES)) {
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
    // 버튼을 잠갔어도 Enter로 폼이 제출된다 — 잠금은 여기서도 본다.
    if (submitting || !title.trim() || !videoFile || lockReason) return
    setSubmitting(true)
    setSubmitError(null)
    setProgress(null)
    try {
      const pending = materials.filter((material) => !linkedMaterialIds.current.has(material.id))
      await uploadRecordedLesson({
        clientRequestId: clientRequestId.current,
        curriculumId,
        sectionId,
        title: title.trim(),
        description: description.trim(),
        videoFile,
        // 재시도면 아직 안 붙은 것만 보낸다 — 진행률의 (n/m)도 그 남은 개수를 센다.
        materials: pending.map((material) => material.file),
        onMaterialLinked: (file) => {
          const linked = pending.find((material) => material.file === file)
          if (linked) linkedMaterialIds.current.add(linked.id)
        },
        onProgress: setProgress,
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
      // 실패한 단계를 진행 막대로 남겨 두지 않는다 — 아래 오류 문구가 어디서 멈췄는지 말해 준다.
      setProgress(null)
    }
  }

  // 컴포넌트가 다른 커리큘럼/섹션으로 재사용될 때 이전 입력을 들고 가지 않는다.
  useEffect(() => {
    clientRequestId.current = crypto.randomUUID()
    linkedMaterialIds.current = new Set()
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
  const canSubmit = Boolean(title.trim() && videoFile && !fileError && !submitting && !lockReason)

  return (
    <div className="workspace-page workspace-page--narrow lesson-form-page recorded-lesson-upload-page">
      <PageHeader
        title="녹화강의 업로드"
        description={`${curriculum.title} · ${section.title}`}
        action={<Link className="button button--soft" to={instructorPaths.curriculumManage(curriculumId)}>구성으로 돌아가기</Link>}
      />

      {lockReason && (
        <InlineNotice tone="warning">
          <strong>지금은 녹화강의를 업로드할 수 없습니다.</strong> {lockReason}
        </InlineNotice>
      )}

      <form className="workspace-form lesson-form recorded-lesson-upload-form" onSubmit={submit}>
        <div className="lesson-form__top-grid">
          <Panel className="lesson-form__panel lesson-form__panel--basic" title="강의 기본 정보" description="수강생에게 표시할 녹화강의 정보와 자료를 입력합니다.">
            <div className="form-grid">
              <label className="form-field--wide"><span>강의 제목 *</span><input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="form-field--wide"><span>설명</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            </div>
            <div className="lesson-form__embedded-section lesson-form__materials-section">
              <div className="lesson-form__embedded-heading"><div className="lesson-form__section-title"><h3>강의 자료</h3><StatusBadge tone={materials.length ? 'warning' : 'neutral'}>{materials.length ? `${materials.length}개 업로드 대기` : '자료 없음'}</StatusBadge></div></div>
              <label className={`material-dropzone lesson-form__dropzone${materialDragActive ? ' is-drag-active' : ''}`} onDragEnter={(event) => { event.preventDefault(); setMaterialDragActive(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDragLeave={() => setMaterialDragActive(false)} onDrop={dropMaterialFiles}>
                <input aria-label="녹화강의 자료 파일" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple onChange={selectMaterials} />
                <span className="lesson-form__pptx-icon" aria-hidden="true"><span>PPTX</span></span>
                <span className="lesson-form__dropzone-copy"><strong>PPTX 파일을 드래그하거나 클릭해 선택</strong><small>여러 파일 동시 등록 가능 · 파일당 최대 50MB</small></span>
              </label>
              {materials.length > 0 && <ul className="material-list lesson-form__material-list">{materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><StatusBadge tone="warning">대기</StatusBadge><button type="button" aria-label={`${material.name} 제거`} onClick={() => setMaterials((current) => current.filter((item) => item.id !== material.id))}>×</button></li>)}</ul>}
            </div>
          </Panel>

          <Panel className="lesson-form__panel lesson-form__panel--schedule recorded-upload__video-panel" title="동영상 업로드" description="한 강의에 MP4 원본 영상 한 개를 등록합니다.">
            {videoFile ? (
              <div className="recorded-video-preview-card" aria-label="선택한 녹화 영상">
                <label className="recorded-video-preview-picker">
                  <input aria-label="MP4 영상 파일" accept={RECORDED_LESSON_VIDEO_ACCEPT} type="file" onChange={selectVideo} />
                  <video src={videoPreviewUrl || undefined} muted preload="metadata" aria-label={`${videoFile.name} 썸네일`} />
                  <span className="recorded-video-preview-picker__action">다른 영상으로 교체</span>
                </label>
                <strong className="recorded-video-preview-title">{videoFile.name}</strong>
                <button className="button button--danger button--small" type="button" onClick={removeVideo}>영상 삭제</button>
              </div>
            ) : (
              <label className="material-dropzone recorded-video-dropzone"><input aria-label="MP4 영상 파일" accept={RECORDED_LESSON_VIDEO_ACCEPT} type="file" onChange={selectVideo} /><span className="material-dropzone__icon">MP4</span><strong>MP4 영상 선택</strong><small>최대 5GiB · 한 개의 영상만 등록할 수 있습니다.</small></label>
            )}
            {fileError && <p className="recorded-upload-error" role="alert">{fileError}</p>}
          </Panel>

          <Panel className="lesson-form__panel lesson-form__panel--policy recorded-upload__detail-panel" title="업로드 세부 확인" description="선택한 파일과 자동 처리 방식을 업로드 전에 확인하세요.">
            <dl className="recorded-upload-summary"><div><dt>동영상</dt><dd>{videoFile ? videoFile.name : '선택 전'}</dd></div><div><dt>원본 크기</dt><dd>{videoFile ? formatRecordedLessonFileSize(videoFile.size) : '--'}</dd></div><div><dt>강의 자료</dt><dd>{materials.length}개</dd></div></dl>
            <ul className="policy-list lesson-form__policy-list"><li><span>HLS</span><div><strong>재생용 변환</strong><p>업로드 후 HLS 변환과 영상 검증을 자동으로 진행합니다.</p></div></li><li><span>CC</span><div><strong>AI 자막</strong><p>{lockReason ? '외부 유료 STT API를 쓰는 경로라 지금은 잠겨 있습니다.' : '영상 처리와 함께 자막을 생성합니다.'}</p></div></li><li><span>公</span><div><strong>자동 공개</strong><p>영상과 자막 검증이 끝나면 수강생에게 공개됩니다.</p></div></li></ul>
            <InlineNotice tone={lockReason ? 'warning' : videoFile ? 'info' : 'warning'}>
              {lockReason
                ? '업로드가 잠겨 있어 제출할 수 없습니다.'
                : videoFile
                  ? '필수 영상이 준비되었습니다. 제목과 자료를 마지막으로 확인해 주세요.'
                  : '업로드할 MP4 영상을 선택해 주세요.'}
            </InlineNotice>
          </Panel>
        </div>

        {submitError && <InlineNotice tone="danger">{submitError}</InlineNotice>}
        {progress && <UploadProgressNotice label={recordedUploadLabel(progress)} ratio={progress.ratio} />}

        <div className="sticky-form-actions lesson-form__actions">
          <Link className="button button--ghost" to={instructorPaths.curriculumManage(curriculumId)}>취소</Link>
          <button className="button button--primary button--large" type="submit" disabled={!canSubmit}>
            {submitting ? '업로드 중…' : '녹화강의 업로드'}
          </button>
        </div>
      </form>
    </div>
  )
}
