import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import CurriculumAssetsFields from '@/features/curriculum/CurriculumAssetsFields'
import CurriculumPublishPanel from '@/features/curriculum/CurriculumPublishPanel'
import { type CurriculumImageSelection } from '@/features/curriculum/CurriculumImageField'
import {
  deleteLesson,
  deleteSection,
  getCurriculumManagementStructure,
  getInstructorCurriculum,
  publishCurriculum,
  saveCurriculumManagement,
  type CurriculumManagementSection,
  type InstructorCurriculumResponse,
} from '@/features/curriculum/curriculumManagementService'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import { publishLesson } from '@/features/lesson/lessonService'
import InstructorEnrollmentRoster from '@/features/enrollment/InstructorEnrollmentRoster'
import { ApiError } from '@/shared/api/client'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import { useToast } from '@/shared/ui/Toast'
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

type ManageTab = 'structure' | 'info' | 'enrollees'

/**
 * 탭의 표시 순서. 작성 흐름(기본 정보 → 구성 → 게시)대로 읽히게 둔다.
 * 진입 기본 탭은 이 순서와 무관하게 DEFAULT_MANAGE_TAB이다 — 초안 생성 직후 바로 구성을 이어 가야 한다.
 */
const MANAGE_TABS: ReadonlyArray<TabItem<ManageTab>> = [
  { id: 'info', label: '기본 정보' },
  { id: 'structure', label: '구성' },
  { id: 'enrollees', label: '수강생' },
]

const DEFAULT_MANAGE_TAB: ManageTab = 'structure'
const MANAGE_TAB_PREFIX = 'curriculum-manage'

/**
 * 발행 버튼은 DRAFT에서만 의미가 있다 — 서버가 DRAFT 외의 전이를 409로 막는다
 * (InstructorCurriculumService.publish). 상태를 화면의 단일 출처로 삼는다.
 *
 * <p>label은 축 이름(DRAFT)이 아니라 강사가 알고 싶은 결과를 쓴다. ARCHIVED가 따로 있어야 하는
 * 이유는 "PUBLISHED가 아니면 비공개"로 뭉개면 보관 상태를 초안과 구별할 수 없기 때문이다.
 */
const LIFECYCLE_VIEW: Record<string, { tone: 'warning' | 'success' | 'neutral'; label: string; description: string }> = {
  DRAFT: { tone: 'warning', label: '비공개', description: '게시해야 수강생에게 보입니다.' },
  PUBLISHED: { tone: 'success', label: '공개 중', description: '카탈로그에서 검색·수강신청할 수 있습니다.' },
  ARCHIVED: { tone: 'neutral', label: '보관됨', description: '카탈로그에 노출되지 않습니다.' },
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
  // 탭은 재seed(key 교체)로 리셋되면 안 되므로 키 바깥에 둔다 — 일괄 게시나 강의 삭제 뒤에
  // 보고 있던 탭에서 계속 작업할 수 있어야 한다.
  const [tab, setTab] = useState<ManageTab>(DEFAULT_MANAGE_TAB)
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

  // 서버 구조(섹션·강의 수)가 바뀌면 에디터를 새 데이터로 다시 seeding한다 — 강의 추가 후
  // 관리로 돌아왔을 때 옛 로컬 state에 멈춰 섹션·강의가 안 보이던 문제 해결. 편집 중에는
  // 서버 데이터가 그대로라 key도 안 바뀌어 자동저장 흐름을 방해하지 않는다.
  // 강의 상태까지 키에 넣는다 — 일괄 게시 후 서버는 PUBLISHED인데 에디터 로컬 state가 DRAFT로
  // 남아 배지가 안 바뀌던 문제. 상태는 편집 중에 변하지 않으므로 자동저장 흐름은 그대로다.
  const structureKey = managementQuery.data.sections
    .map((section) => `${section.sectionId}:${section.lessons.map((lesson) => lesson.status).join('|')}`)
    .join(',')
  return <CurriculumManageEditor
    key={`${curriculumId}:${structureKey}`}
    curriculumId={curriculumId}
    routeState={routeState}
    storedCurriculum={managementQuery.data.curriculum}
    initialSections={managementQuery.data.sections}
    tab={tab}
    onTabChange={setTab}
  />
}

function CurriculumManageEditor({
  curriculumId,
  routeState,
  storedCurriculum,
  initialSections,
  tab,
  onTabChange,
}: {
  curriculumId: string
  routeState: CurriculumDraftState | null
  storedCurriculum: InstructorCurriculumResponse
  initialSections: CurriculumManagementSection[]
  tab: ManageTab
  onTabChange: (tab: ManageTab) => void
}) {
  const isNewDraft = storedCurriculum?.lifecycleStatus === 'DRAFT'
  const lifecycleView = LIFECYCLE_VIEW[storedCurriculum.lifecycleStatus]
    ?? { tone: 'neutral' as const, label: storedCurriculum.lifecycleStatus, description: '알 수 없는 상태입니다.' }
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
  const toast = useToast()
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
  /** 저장에 성공했으면(또는 저장할 게 없으면) true. 게시는 이 값이 false면 중단한다. */
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      dirtyAfterSaveRef.current = true   // 저장 중 변경 — 끝나고 한 번 더
      return true
    }
    const signature = currentSignature()
    if (signature === savedSignatureRef.current) return true   // 바뀐 게 없음

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
      return true
    } catch (error) {
      setAutosave('error')
      if (error instanceof ApiError && error.code === 'STRUCTURE_VERSION_CONFLICT') {
        setSaveError('구조가 다른 곳에서 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.')
      } else if (isNotImplemented(error)) {
        setSaveError('아직 준비 중인 항목이 포함돼 저장하지 못했습니다.')
      } else {
        setSaveError('변경 내용을 자동 저장하지 못했습니다.')
      }
      return false
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


  // 게시가 바꾸는 범위는 이 화면 밖까지다 — 내 커리큘럼 카드의 상태·삭제 버튼, 대시보드 집계,
  // 공개 카탈로그 목록·상세, 사이드바 목차. staleTime(30초) 때문에 빠뜨리면 되돌아갔을 때
  // 한동안 옛 캐시가 그대로 보인다(삭제 버튼이 늦게 사라지던 원인).
  const invalidateAfterPublish = () => {
    queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
    queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] })
    queryClient.invalidateQueries({ queryKey: ['my-curriculums'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    queryClient.invalidateQueries({ queryKey: ['curriculums'] })
  }

  /**
   * 게시 카드의 주 동작. 수강생에게 보이려면 커리큘럼과 강의가 모두 PUBLISHED여야 하므로
   * (ADR-0002), 초안 강의를 올리고 커리큘럼 공개까지 한 번에 끝낸다. 서버 축은 여전히 분리돼
   * 있지만(ADR-0021) 강사가 두 번 눌러야 하는 일은 없어야 한다 — 한 번 눌러 "공개" 상태에 도달한다.
   *
   * @param includeLessons false면 초안 강의는 그대로 두고 커리큘럼만 공개한다(일부만 먼저 공개하는 경우).
   */
  const runPublish = async (includeLessons: boolean) => {
    const draftLessons = includeLessons
      ? sections.flatMap((section) => section.lessons.filter((lesson) => lesson.status === 'DRAFT'))
      : []
    const willPublishCurriculum = isNewDraft
    if (draftLessons.length === 0 && !willPublishCurriculum) return

    const plan = [
      draftLessons.length > 0 ? `초안 강의 ${draftLessons.length}개` : null,
      willPublishCurriculum ? '커리큘럼' : null,
    ].filter(Boolean).join('와 ')
    if (!window.confirm(`${plan}을(를) 게시할까요? 게시하면 수강생에게 바로 공개됩니다.`)) return

    setSaveError('')
    // 저장이 실패한 채로 게시하면 화면에 보이는 내용과 공개되는 내용이 갈린다 — 게시를 멈춘다.
    if (!await flushSave()) {
      toast.error('변경 내용을 저장하지 못해 게시를 중단했습니다. 저장 오류를 먼저 해결해 주세요.')
      return
    }

    // 일부만 실패해도 나머지는 게시된 채로 둔다 — 전부 되돌릴 방법이 없으므로 결과를 그대로 알린다.
    const results = await Promise.allSettled(draftLessons.map((lesson) => publishLesson(lesson.lessonId)))
    const lessonFailed = results.filter((result) => result.status === 'rejected').length
    const lessonPublished = results.length - lessonFailed
    const visibleLessonCount = publishedLessonCount + lessonPublished

    // 목차가 빈 커리큘럼을 공개하지 않는다 — 강의가 하나도 안 올라갔으면 공개를 보류한다.
    if (willPublishCurriculum && totalLessonCount > 0 && visibleLessonCount === 0) {
      invalidateAfterPublish()
      toast.error('강의를 게시하지 못해 커리큘럼 공개를 중단했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }

    let curriculumPublished = false
    if (willPublishCurriculum) {
      try {
        await publishCurriculum(curriculumId)
        curriculumPublished = true
        setAutosave('saved')
      } catch (error) {
        // 상태 충돌(이미 발행됨 등)은 서버 메시지가 원인을 정확히 말해준다 — 뭉개면 사용자가
        // 같은 버튼을 계속 누르게 된다. 재조회로 화면 상태도 정합시킨다.
        setSaveError(error instanceof ApiError && error.code === 'CURRICULUM_STATE_CONFLICT'
          ? error.message
          : '커리큘럼을 게시하지 못했습니다.')
      }
    }

    invalidateAfterPublish()

    if (lessonFailed > 0) {
      toast.error(lessonPublished > 0
        ? `강의 ${lessonPublished}개를 게시했고 ${lessonFailed}개는 실패했습니다.`
        : '강의를 게시하지 못했습니다.')
      return
    }
    if (willPublishCurriculum && !curriculumPublished) {
      toast.error('커리큘럼을 게시하지 못했습니다.')
      return
    }
    toast.success(curriculumPublished
      ? `커리큘럼을 게시했습니다. 강의 ${visibleLessonCount}개가 수강생에게 공개됩니다.`
      : `강의 ${lessonPublished}개를 게시했습니다.`)
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

  const removeLesson = async (sectionId: string, lessonId: string) => {
    if (!window.confirm('이 강의를 삭제할까요? 되돌릴 수 없습니다.')) return
    try {
      await deleteLesson(lessonId)
      // 로컬 state를 직접 고치면 자동저장이 옛 structureVersion으로 돌아 409(구조 변경)가 난다.
      // 서버 구조를 다시 읽어(structureKey 변경) 최신 버전으로 다시 그리고 사이드바도 갱신한다.
      queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
      queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] })
      toast.success('강의를 삭제했습니다.')
    } catch {
      toast.error('강의를 삭제하지 못했습니다.')
    }
  }

  const removeSection = async (sectionId: string, lessonCount: number) => {
    // 강의가 남은 섹션은 서버가 409(SECTION_NOT_EMPTY)로 막는다 — 실수로 강의까지 지우지 않도록.
    // 눌러 보고 알기 전에 먼저 안내한다(버튼도 비활성).
    if (lessonCount > 0) {
      toast.error('강의가 있는 섹션은 삭제할 수 없어요. 강의를 먼저 삭제하거나 다른 섹션으로 옮겨 주세요.')
      return
    }
    if (!window.confirm('이 섹션을 삭제할까요? 되돌릴 수 없습니다.')) return
    // 아직 저장하지 않은 새 섹션은 서버에 없으므로 로컬에서만 제거한다.
    if (sectionId.startsWith('sec-new-')) {
      setSections((current) => current.filter((section) => section.sectionId !== sectionId))
      toast.success('섹션을 삭제했습니다.')
      return
    }
    try {
      await deleteSection(sectionId)
      queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
      queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] })
      toast.success('섹션을 삭제했습니다.')
    } catch (error) {
      // 로컬 목록이 낡아 강의가 없어 보였을 수 있다(다른 탭에서 강의 추가 등) — 서버 판정을 그대로 안내한다.
      toast.error(error instanceof ApiError && error.code === 'SECTION_NOT_EMPTY'
        ? '강의가 있는 섹션은 삭제할 수 없어요. 강의를 먼저 삭제하거나 다른 섹션으로 옮겨 주세요.'
        : '섹션을 삭제하지 못했습니다.')
    }
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

  // 게시 카드에서 "무엇이 실제로 공개되는지"를 보여 준다 — 공개 목차는 PUBLISHED 강의만 담는다.
  const allLessons = sections.flatMap((section) => section.lessons)
  const totalLessonCount = allLessons.length
  const draftLessonCount = allLessons.filter((lesson) => lesson.status === 'DRAFT').length
  const publishedLessonCount = allLessons.filter((lesson) => lesson.status === 'PUBLISHED').length
  // 수강생에게 실제로 보이려면 두 축이 모두 PUBLISHED여야 한다(ADR-0002) — 카탈로그는 PUBLISHED
  // 커리큘럼만 열고, 그 안에서 PUBLISHED 강의만 목차에 담는다.
  const isPubliclyVisible = storedCurriculum.lifecycleStatus === 'PUBLISHED' && publishedLessonCount > 0

  return (
    <div className="workspace-page">
      <PageHeader
        title={curriculumInfo.title || '새 커리큘럼 초안'}
        description="기본 정보, 수강생, 섹션과 강의 편성을 관리합니다."
        action={<div className="header-action-group"><Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼 상세</Link><span className="autosave-status" role="status" aria-live="polite">{autosave === 'saving' ? '자동 저장 중…' : autosave === 'saved' ? '자동 저장됨' : autosave === 'error' ? '저장 실패' : '변경 사항이 자동 저장됩니다'}</span></div>}
      />
      {saveError && <InlineNotice tone="danger">{saveError}</InlineNotice>}
      <div className="metric-grid"><MetricCard label="상태" value={storedCurriculum.lifecycleStatus} helper={isNewDraft ? '게시 전' : '운영 중'} /><MetricCard label="섹션" value={sections.length} /><MetricCard label="전체 강의" value={sections.reduce((sum, section) => sum + section.lessons.length, 0)} /><MetricCard label="수강생" value={storedCurriculum.enrolleeCount ?? '--'} /></div>
      <Tabs
        className="workspace-tabs"
        idPrefix={MANAGE_TAB_PREFIX}
        label="커리큘럼 관리"
        items={MANAGE_TABS}
        value={tab}
        onChange={onTabChange}
      />

      {/* 구성 → 게시 순으로 읽어 내려가며 편성을 마치고 그 자리에서 공개한다. */}
      {tab === 'structure' && (
        <div className="workspace-tabpanel" {...tabPanelProps(MANAGE_TAB_PREFIX, 'structure')}>
          <Panel title="섹션과 강의" description="강의를 드래그해 순서를 바꾸거나 다른 섹션으로 옮길 수 있습니다.">
            {/* 섹션마다 반복하지 않고 여기 한 번만 안내한다(삭제 제약 포함). */}
            <InlineNotice tone="info"><strong>섹션</strong>은 대단원(챕터), <strong>강의</strong>는 그 안의 개별 수업이에요. 먼저 섹션을 추가하면 자동 저장된 뒤, 그 섹션의 “강의 추가”로 강의를 넣을 수 있어요. 강의가 포함된 섹션은 삭제할 수 없습니다. 먼저 강의를 삭제하거나 다른 섹션으로 이동한 뒤 섹션을 삭제해주세요.</InlineNotice>
            <div className="structure-list">
              {sections.map((section, sectionIndex) => (
                <article className={`structure-section${lessonDropTarget?.sectionId === section.sectionId ? ' is-lesson-drop-target' : ''}`} key={section.sectionId}>
                  {/* 라벨·액션이 첫 줄, 입력창은 그 아래 전폭 — 버튼이 입력 폭을 깎지 않도록. */}
                  <header>
                    <div className="drag-handle" aria-hidden="true">⋮⋮</div>
                    <span className="structure-section__eyebrow">SECTION {sectionIndex + 1}</span>
                    <div className="structure-section__fields">
                      <label><small>섹션 이름</small><input aria-label={`섹션 ${sectionIndex + 1} 이름`} maxLength={200} value={section.title} onChange={(event) => updateSection(section.sectionId, 'title', event.target.value)} /></label>
                      <label><small>섹션 설명</small><textarea aria-label={`섹션 ${sectionIndex + 1} 설명`} rows={2} value={section.description} onChange={(event) => updateSection(section.sectionId, 'description', event.target.value)} /></label>
                    </div>
                    <div className="structure-actions">
                      <button aria-label="섹션 위로" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} type="button">↑</button>
                      <button aria-label="섹션 아래로" disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} type="button">↓</button>
                      {section.sectionId.startsWith('sec-new-')
                        ? <button className="button button--soft button--small" type="button" disabled title="새 섹션이 자동 저장된 뒤에 강의를 추가할 수 있어요.">강의 추가</button>
                        : <Link className="button button--soft button--small" to={instructorPaths.newLesson(curriculumId, section.sectionId)}>강의 추가</Link>}
                      <button
                        className="button button--soft button--small"
                        type="button"
                        disabled={section.lessons.length > 0}
                        title={section.lessons.length > 0 ? '강의가 있는 섹션은 삭제할 수 없어요. 강의를 먼저 비워 주세요.' : undefined}
                        onClick={() => void removeSection(section.sectionId, section.lessons.length)}
                      >섹션 삭제</button>
                    </div>
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
                          {/* 배지와 링크·버튼을 한 flex 컨테이너에 모아 같은 수평선에 정렬한다(각각 별도 그리드 칼럼이던 시절엔 어긋났다). */}
                          <div className="lesson-actions">
                            <StatusBadge tone={lesson.status === 'PUBLISHED' ? 'success' : lesson.status === 'READY' ? 'warning' : 'neutral'}>{lesson.status}</StatusBadge>
                            <div className="row-actions">
                              <Link to={instructorPaths.lesson(curriculumId, section.sectionId, lesson.lessonId)}>상세</Link>
                              <button className="text-button" type="button" onClick={() => void removeLesson(section.sectionId, lesson.lessonId)}>삭제</button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                    {section.lessons.length === 0 && <li className="lesson-drop-empty" aria-hidden="true">강의를 이 섹션으로 드래그하세요.</li>}
                  </ul>
                </article>
              ))}
            </div>
            <button className="structure-add-section" type="button" onClick={addSection}>+ 섹션 추가</button>
          </Panel>

          <CurriculumPublishPanel
            isNewDraft={isNewDraft}
            lifecycleView={lifecycleView}
            draftLessonCount={draftLessonCount}
            publishedLessonCount={publishedLessonCount}
            totalLessonCount={totalLessonCount}
            isPubliclyVisible={isPubliclyVisible}
            onPublish={(includeLessons) => void runPublish(includeLessons)}
          />
        </div>
      )}

      {/* 기본 정보 → 자산 순으로 확인한다. 게시는 구성 탭 맨 아래에서 한다. */}
      {tab === 'info' && (
        <div className="workspace-tabpanel" {...tabPanelProps(MANAGE_TAB_PREFIX, 'info')}>
          <Panel title="기본 정보" description="일반 수정과 공개 상태 전환은 분리합니다.">
            <div className="form-grid"><label className="form-field--wide"><span>제목</span><input value={curriculumInfo.title} onChange={(event) => updateCurriculumInfo('title', event.target.value)} /></label><label className="form-field--wide"><span>짧은 소개</span><input value={curriculumInfo.summary} onChange={(event) => updateCurriculumInfo('summary', event.target.value)} /></label><label className="form-field--wide"><span>상세 설명</span><textarea rows={6} value={curriculumInfo.description} onChange={(event) => updateCurriculumInfo('description', event.target.value)} /></label></div>
          </Panel>

          {/* 새 커리큘럼 만들기와 같은 카드를 재사용한다(CurriculumAssetsFields). */}
          <Panel title="대표 이미지와 강의 자료" description="대표 이미지와 커리큘럼 전체에서 공통으로 사용할 선택 자료를 등록합니다.">
            <CurriculumAssetsFields
              idPrefix="manage-curriculum"
              thumbnailPreviewUrl={thumbnailUrl}
              onThumbnailChange={(selection: CurriculumImageSelection | null) => updateThumbnail(selection?.previewUrl ?? null)}
              materials={materials}
              onMaterialsChange={updateMaterials}
            />
          </Panel>
        </div>
      )}

      {tab === 'enrollees' && (
        <div className="workspace-tabpanel" {...tabPanelProps(MANAGE_TAB_PREFIX, 'enrollees')}>
          <Panel title="수강 신청과 수강생" description="승인 대기, 수강 중, 종료된 수강 상태를 관리합니다.">
            <InstructorEnrollmentRoster curriculumId={curriculumId} />
          </Panel>
        </div>
      )}
    </div>
  )
}
