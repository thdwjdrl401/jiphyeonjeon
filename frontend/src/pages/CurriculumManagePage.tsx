import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import CurriculumImageField, { type CurriculumImageSelection } from '@/features/curriculum/CurriculumImageField'
import CurriculumMaterialField from '@/features/curriculum/CurriculumMaterialField'
import {
  getCurriculumManagementStructure,
  getInstructorCurriculum,
  publishCurriculum,
  saveCurriculumManagement,
  type CurriculumManagementSection,
  type InstructorCurriculumResponse,
} from '@/features/curriculum/curriculumManagementService'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import InstructorEnrollmentRoster from '@/features/enrollment/InstructorEnrollmentRoster'
import { ApiError } from '@/shared/api/client'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
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
interface DraggedLesson {
  sectionId: string
  lessonId: string
}
interface LessonDropTarget {
  sectionId: string
  lessonIndex: number
}

export default function CurriculumManagePage() {
  const { curriculumId } = useParams()
  const location = useLocation()
  const routeState = location.state as CurriculumDraftState | null
  const managementQuery = useQuery({
    queryKey: ['curriculum-management', curriculumId],
    queryFn: async () => {
      const [curriculum, sections] = await Promise.all([
        getInstructorCurriculum(curriculumId!),
        getCurriculumManagementStructure(curriculumId!),
      ])
      return { curriculum, sections }
    },
    enabled: Boolean(curriculumId),
  })
  usePageTitle('커리큘럼 관리')

  if (!curriculumId) return <PageState title="커리큘럼을 찾을 수 없습니다" />
  if (managementQuery.isPending) return <PageState title="커리큘럼을 불러오는 중입니다" />
  if (managementQuery.isError) return <PageState title="커리큘럼을 불러오지 못했습니다" description="잠시 후 다시 시도해 주세요." />

  return <CurriculumManageEditor
    key={curriculumId}
    curriculumId={curriculumId}
    routeState={routeState}
    storedCurriculum={managementQuery.data.curriculum}
    initialSections={managementQuery.data.sections}
  />
}

function CurriculumManageEditor({
  curriculumId,
  routeState,
  storedCurriculum,
  initialSections,
}: {
  curriculumId: string
  routeState: CurriculumDraftState | null
  storedCurriculum: InstructorCurriculumResponse
  initialSections: CurriculumManagementSection[]
}) {
  const isNewDraft = storedCurriculum?.lifecycleStatus === 'DRAFT'
  const [tab, setTab] = useState<'structure' | 'info' | 'enrollees'>('structure')
  const [sections, setSections] = useState(initialSections)
  // structureVersion을 로컬로 들고 저장 때마다 갱신한다 — 안 그러면 새로고침 없이 연속 저장 시
  // 낡은 baseVersion을 보내 409로 실패한다(order PUT의 낙관적 동시성).
  const [structureVersion, setStructureVersion] = useState(storedCurriculum.structureVersion)
  const [curriculumInfo, setCurriculumInfo] = useState({
    title: routeState?.draft?.title ?? storedCurriculum?.title ?? '',
    summary: routeState?.draft?.summary ?? storedCurriculum?.summary ?? '',
    description: routeState?.draft?.description ?? storedCurriculum?.description ?? '',
  })
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(routeState?.draft?.thumbnailUrl ?? storedCurriculum?.thumbnailUrl ?? null)
  const [materials, setMaterials] = useState<CurriculumMaterial[]>(routeState?.draft?.materials ?? storedCurriculum.materials)
  const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved' | 'error'>(routeState?.created ? 'saved' : 'idle')
  const [saveError, setSaveError] = useState('')
  const [draggedLesson, setDraggedLesson] = useState<DraggedLesson | null>(null)
  const [lessonDropTarget, setLessonDropTarget] = useState<LessonDropTarget | null>(null)

  const queryClient = useQueryClient()
  const structureVersionRef = useRef(structureVersion)
  structureVersionRef.current = structureVersion
  // 저장 중 여부와, 저장 도중 들어온 변경을 기억해 저장이 끝나면 한 번 더 돌린다(마지막 변경까지 반영).
  const savingRef = useRef(false)
  const dirtyAfterSaveRef = useRef(false)
  // 서버에 이미 반영된 상태의 서명. 이 서명과 같으면 저장을 건너뛴다. 섹션 자체 id는 저장 후
  // 임시→실제로 바뀌므로 서명에서 제외한다(내용·순서만 본다) — 그래야 id 교체가 재저장을 유발하지 않는다.
  const savedSignatureRef = useRef<string | null>(null)

  const currentSignature = useCallback(() => JSON.stringify({
    info: curriculumInfo,
    sections: sections.map((section) => ({
      title: section.title,
      description: section.description,
      lessons: section.lessons.map((lesson) => lesson.lessonId),
    })),
  }), [curriculumInfo, sections])


  // 구조·기본정보 자동저장. 자료(materials)는 시그니처에 넣지 않아 자료 편집만으로는 저장이 돌지 않는다
  // — 커리큘럼-레벨 자료 연결 API가 없기 때문(ADR-0030). 구조/정보 저장 시 현재 자료를 함께 실어
  // mock이 기존 자료를 잃지 않게만 한다.
  const flushSave = useCallback(async () => {
    if (savingRef.current) {
      dirtyAfterSaveRef.current = true   // 저장 중 변경 — 끝나고 한 번 더
      return
    }
    const signature = currentSignature()
    if (signature === savedSignatureRef.current) return   // 바뀐 게 없음

    savingRef.current = true
    setAutosave('saving')
    setSaveError('')
    try {
      const result = await saveCurriculumManagement({
        curriculumId,
        info: curriculumInfo,
        sections,
        // 커리큘럼-레벨 자료는 아직 서버에 반영되지 않지만(ADR-0030), 현재 상태를 그대로 실어
        // mock 저장이 기존 자료를 지우지 않게 한다. 실 API에서는 자료가 비어 있어 가드를 통과한다.
        materials,
        structureVersion: structureVersionRef.current,
      })
      // 새로 만든 섹션의 임시 id를 실제 id로 교체 — 안 하면 다음 저장에서 같은 섹션을 또 만들고,
      // "강의 추가"가 존재하지 않는 섹션을 가리킨다.
      if (Object.keys(result.sectionIdMap).length > 0) {
        setSections((current) => current.map((section) =>
          result.sectionIdMap[section.sectionId]
            ? { ...section, sectionId: result.sectionIdMap[section.sectionId] }
            : section))
      }
      setStructureVersion(result.structureVersion)
      savedSignatureRef.current = signature
      setAutosave('saved')
      // 사이드바 등 다른 화면이 최신 구조를 읽도록.
      queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] })
    } catch (error) {
      setAutosave('error')
      if (error instanceof ApiError && error.code === 'STRUCTURE_VERSION_CONFLICT') {
        setSaveError('구조가 다른 곳에서 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.')
      } else if (isNotImplemented(error)) {
        setSaveError('아직 준비 중인 항목이 포함돼 저장하지 못했습니다.')
      } else {
        setSaveError('변경 내용을 자동 저장하지 못했습니다.')
      }
    } finally {
      savingRef.current = false
      if (dirtyAfterSaveRef.current) {
        dirtyAfterSaveRef.current = false
        void flushSave()
      }
    }
  }, [curriculumId, curriculumInfo, sections, materials, currentSignature, queryClient])

  // 변경 후 디바운스 자동저장. 첫 렌더에서는 현재 상태를 "저장됨"으로 기록만 하고 저장하지 않는다.
  useEffect(() => {
    if (savedSignatureRef.current === null) {
      savedSignatureRef.current = currentSignature()
      return
    }
    if (currentSignature() === savedSignatureRef.current) return
    const timer = window.setTimeout(() => void flushSave(), 1000)
    return () => window.clearTimeout(timer)
  }, [currentSignature, flushSave])

  const updateCurriculumInfo = (field: CurriculumInfoField, value: string) => {
    setCurriculumInfo((current) => ({ ...current, [field]: value }))
  }

  const updateThumbnail = (value: string | null) => {
    setThumbnailUrl(value)
  }

  const updateMaterials = (value: CurriculumMaterial[]) => {
    setMaterials(value)
  }


  const publish = async () => {
    setSaveError('')
    try {
      await flushSave()   // 게시 전 대기 중인 편집을 먼저 반영
      await publishCurriculum(curriculumId)
      queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
      setAutosave('saved')
    } catch {
      setSaveError('커리큘럼을 게시하지 못했습니다.')
    }
  }

  const updateSection = (sectionId: string, field: SectionInfoField, value: string) => {
    setSections((current) => current.map((section) => section.sectionId === sectionId ? { ...section, [field]: value } : section))
  }

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    setSections((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const addSection = () => {
    setSections((current) => [
      ...current,
      {
        sectionId: `sec-new-${Date.now()}`,
        title: '새 섹션',
        description: '설명을 입력해 주세요.',
        order: current.length + 1,
        lessons: [],
      },
    ])
  }

  const moveLesson = (
    source: DraggedLesson,
    targetSectionId: string,
    targetLessonIndex: number,
  ) => {
    setSections((current) => {
      const sourceSectionIndex = current.findIndex((section) => section.sectionId === source.sectionId)
      const targetSectionIndex = current.findIndex((section) => section.sectionId === targetSectionId)
      if (sourceSectionIndex < 0 || targetSectionIndex < 0) return current

      const next = current.map((section) => ({ ...section, lessons: [...section.lessons] }))
      const sourceLessons = next[sourceSectionIndex].lessons
      const sourceLessonIndex = sourceLessons.findIndex((lesson) => lesson.lessonId === source.lessonId)
      if (sourceLessonIndex < 0) return current

      const [lesson] = sourceLessons.splice(sourceLessonIndex, 1)
      const targetLessons = next[targetSectionIndex].lessons
      const adjustedTargetIndex = source.sectionId === targetSectionId && sourceLessonIndex < targetLessonIndex
        ? targetLessonIndex - 1
        : targetLessonIndex
      const insertAt = Math.max(0, Math.min(adjustedTargetIndex, targetLessons.length))
      targetLessons.splice(insertAt, 0, lesson)
      return next
    })
  }

  const startLessonDrag = (
    event: ReactDragEvent<HTMLLIElement>,
    sectionId: string,
    lessonId: string,
  ) => {
    const source = { sectionId, lessonId }
    setDraggedLesson(source)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', JSON.stringify(source))
  }

  const setLessonRowDropTarget = (
    event: ReactDragEvent<HTMLLIElement>,
    sectionId: string,
    lessonIndex: number,
  ) => {
    if (!draggedLesson) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const insertAfter = event.clientY > bounds.top + bounds.height / 2
    setLessonDropTarget({ sectionId, lessonIndex: lessonIndex + (insertAfter ? 1 : 0) })
  }

  const setLessonListDropTarget = (
    event: ReactDragEvent<HTMLUListElement>,
    sectionId: string,
    lessonCount: number,
  ) => {
    if (!draggedLesson || event.target !== event.currentTarget) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setLessonDropTarget({ sectionId, lessonIndex: lessonCount })
  }

  const dropLesson = (
    event: ReactDragEvent<HTMLElement>,
    sectionId: string,
    lessonIndex: number,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (draggedLesson) moveLesson(draggedLesson, sectionId, lessonIndex)
    setDraggedLesson(null)
    setLessonDropTarget(null)
  }

  const finishLessonDrag = () => {
    setDraggedLesson(null)
    setLessonDropTarget(null)
  }

  return (
    <div className="workspace-page">
      <PageHeader
        eyebrow="CURRICULUM STUDIO"
        title={curriculumInfo.title || '새 커리큘럼 초안'}
        description="기본 정보, 수강생, 섹션과 강의 편성을 관리합니다."
        action={<div className="header-action-group"><Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼 상세</Link><span className="autosave-status" role="status" aria-live="polite">{autosave === 'saving' ? '자동 저장 중…' : autosave === 'saved' ? '자동 저장됨' : autosave === 'error' ? '저장 실패' : '변경 사항이 자동 저장됩니다'}</span></div>}
      />
      {saveError && <InlineNotice tone="danger">{saveError}</InlineNotice>}
      <div className="metric-grid"><MetricCard label="상태" value={storedCurriculum.lifecycleStatus} helper={isNewDraft ? '게시 전' : '운영 중'} /><MetricCard label="섹션" value={sections.length} /><MetricCard label="전체 강의" value={sections.reduce((sum, section) => sum + section.lessons.length, 0)} /><MetricCard label="수강생" value={storedCurriculum.enrolleeCount ?? '--'} /></div>
      <div className="workspace-tabs" role="tablist"><button className={tab === 'structure' ? 'is-active' : ''} onClick={() => setTab('structure')} type="button">구성</button><button className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')} type="button">기본 정보</button><button className={tab === 'enrollees' ? 'is-active' : ''} onClick={() => setTab('enrollees')} type="button">수강생</button></div>

      {tab === 'structure' && (
        <Panel title="섹션과 강의" description="강의를 드래그해 순서를 바꾸거나 다른 섹션으로 옮길 수 있습니다." action={<button className="button button--soft" type="button" onClick={addSection}>섹션 추가</button>}>
          <div className="structure-list">
            {sections.map((section, sectionIndex) => (
              <article className={`structure-section${lessonDropTarget?.sectionId === section.sectionId ? ' is-lesson-drop-target' : ''}`} key={section.sectionId}>
                <header>
                  <div className="drag-handle" aria-hidden="true">⋮⋮</div>
                  <div className="structure-section__fields">
                    <span>SECTION {sectionIndex + 1}</span>
                    <label><small>섹션 이름</small><input aria-label={`섹션 ${sectionIndex + 1} 이름`} maxLength={200} value={section.title} onChange={(event) => updateSection(section.sectionId, 'title', event.target.value)} /></label>
                    <label><small>섹션 설명</small><textarea aria-label={`섹션 ${sectionIndex + 1} 설명`} rows={2} value={section.description} onChange={(event) => updateSection(section.sectionId, 'description', event.target.value)} /></label>
                  </div>
                  <div className="structure-actions"><button aria-label="섹션 위로" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} type="button">↑</button><button aria-label="섹션 아래로" disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} type="button">↓</button>{section.sectionId.startsWith('sec-new-')
                    ? <button className="button button--soft button--small" type="button" disabled title="새 섹션이 자동 저장된 뒤에 강의를 추가할 수 있어요.">강의 추가</button>
                    : <Link className="button button--soft button--small" to={instructorPaths.newLesson(curriculumId, section.sectionId)}>강의 추가</Link>}</div>
                </header>
                <ul
                  className={lessonDropTarget?.sectionId === section.sectionId && lessonDropTarget.lessonIndex === section.lessons.length ? 'is-drop-at-end' : undefined}
                  aria-label={`${section.title} 강의 목록`}
                  onDragOver={(event) => setLessonListDropTarget(event, section.sectionId, section.lessons.length)}
                  onDrop={(event) => dropLesson(event, section.sectionId, section.lessons.length)}
                >
                  {section.lessons.map((lesson, lessonIndex) => {
                    const isDragging = draggedLesson?.lessonId === lesson.lessonId
                    const isDropBefore = lessonDropTarget?.sectionId === section.sectionId
                      && lessonDropTarget.lessonIndex === lessonIndex
                    return (
                      <li
                        className={`${isDragging ? 'is-dragging' : ''}${isDropBefore ? ' is-drop-before' : ''}`.trim() || undefined}
                        key={lesson.lessonId}
                        draggable
                        aria-label={`${lesson.title} 강의`}
                        onDragStart={(event) => startLessonDrag(event, section.sectionId, lesson.lessonId)}
                        onDragOver={(event) => setLessonRowDropTarget(event, section.sectionId, lessonIndex)}
                        onDrop={(event) => dropLesson(event, section.sectionId, lessonDropTarget?.lessonIndex ?? lessonIndex)}
                        onDragEnd={finishLessonDrag}
                      >
                        <span className="lesson-drag-handle" aria-hidden="true">⋮⋮</span>
                        <span className="lesson-order">{lessonIndex + 1}</span>
                        <div className="lesson-info"><strong>{lesson.title}</strong><small>{lesson.status}</small></div>
                        <StatusBadge tone={lesson.status === 'PUBLISHED' ? 'success' : lesson.status === 'READY' ? 'warning' : 'neutral'}>{lesson.status}</StatusBadge>
                        <div className="row-actions"><Link to={instructorPaths.lesson(curriculumId, section.sectionId, lesson.lessonId)}>상세</Link></div>
                      </li>
                    )
                  })}
                  {section.lessons.length === 0 && <li className="lesson-drop-empty" aria-hidden="true">강의를 이 섹션으로 드래그하세요.</li>}
                </ul>
              </article>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'info' && (
        <Panel title="기본 정보" description="일반 수정과 공개 상태 전환은 분리합니다.">
          <div className="form-grid"><label className="form-field--wide"><span>제목</span><input value={curriculumInfo.title} onChange={(event) => updateCurriculumInfo('title', event.target.value)} /></label><label className="form-field--wide"><span>짧은 소개</span><input value={curriculumInfo.summary} onChange={(event) => updateCurriculumInfo('summary', event.target.value)} /></label><label className="form-field--wide"><span>상세 설명</span><textarea rows={6} value={curriculumInfo.description} onChange={(event) => updateCurriculumInfo('description', event.target.value)} /></label></div>
          <div className="curriculum-manage-thumbnail"><h3>대표 이미지</h3><p>목록과 상세 카드에 표시할 이미지를 등록합니다.</p><CurriculumImageField id="manage-curriculum-thumbnail" previewUrl={thumbnailUrl} onChange={(selection: CurriculumImageSelection | null) => updateThumbnail(selection?.previewUrl ?? null)} /></div>
          <div className="lifecycle-actions"><div><StatusBadge tone="warning">DRAFT</StatusBadge><p>강의 편성을 확인한 뒤 커리큘럼을 게시하세요.</p></div><button className="button button--primary" type="button" onClick={() => void publish()}>커리큘럼 게시</button></div>
          <div className="curriculum-manage-materials"><h3>커리큘럼 강의 자료 <small>선택</small></h3><p>전체 강의에서 공통으로 제공할 PPTX 자료를 추가하거나 제거합니다.</p><CurriculumMaterialField id="manage-curriculum-materials" value={materials} onChange={updateMaterials} /></div>
        </Panel>
      )}

      {tab === 'enrollees' && (
        <Panel title="수강 신청과 수강생" description="승인 대기, 수강 중, 종료된 수강 상태를 관리합니다.">
          <InstructorEnrollmentRoster curriculumId={curriculumId} />
        </Panel>
      )}
    </div>
  )
}
