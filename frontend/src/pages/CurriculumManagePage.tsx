import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  curriculumManageParams,
  instructorPaths,
  publicPaths,
  type CurriculumManageTab,
} from '@/app/router/paths'
import CurriculumPublishPanel from '@/features/curriculum/CurriculumPublishPanel'
import CurriculumImageField, { type CurriculumImageSelection } from '@/features/curriculum/CurriculumImageField'
import CurriculumMaterialField from '@/features/curriculum/CurriculumMaterialField'
import CurriculumPeriodFields, { type CurriculumPeriodValue } from '@/features/curriculum/CurriculumPeriodFields'
import {
  deleteCurriculum,
  deleteCurriculumThumbnail,
  deleteSection,
  getCurriculumManagementStructure,
  getInstructorCurriculum,
  archiveCurriculum,
  publishCurriculum,
  saveCurriculumManagement,
  updateCurriculumThumbnail,
  uploadCurriculumThumbnail,
  type CurriculumManagementSection,
  type InstructorCurriculumResponse,
  type SaveCurriculumManagementResult,
} from '@/features/curriculum/curriculumManagementService'
import { CurriculumMaterialSyncError } from '@/features/curriculum/curriculumMaterialSyncError'
import { mergeCurriculumMaterials } from '@/features/curriculum/materialMerge'
import { evaluatePublishReadiness } from '@/features/curriculum/publishPreconditions'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import InstructorEnrollmentRoster from '@/features/enrollment/InstructorEnrollmentRoster'
import { resolveInstructorLessonEditPath } from '@/features/lesson/lessonRouting'
import { ApiError } from '@/shared/api/client'
import { isNotImplemented } from '@/shared/api/notImplemented'
import {
  isDateBeforeToday,
  toIsoAtEndOfDayOrNull,
  toIsoAtStartOfDayOrNull,
  toLocalDateInputValue,
} from '@/shared/lib/localDateTime'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

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

/**
 * 탭의 표시 순서. 작성 흐름(기본 정보 → 구성 → 게시)대로 읽히게 둔다.
 * 진입 기본 탭은 이 순서와 무관하게 DEFAULT_MANAGE_TAB이다 — 초안 생성 직후 바로 구성을 이어 가야 한다.
 */
const MANAGE_TABS: ReadonlyArray<TabItem<CurriculumManageTab>> = [
  { id: 'info', label: '기본 정보' },
  { id: 'structure', label: '구성' },
  { id: 'enrollees', label: '수강생' },
]

const DEFAULT_MANAGE_TAB: CurriculumManageTab = 'structure'

function isManageTab(value: string | null): value is CurriculumManageTab {
  return MANAGE_TABS.some((item) => item.id === value)
}
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

/**
 * 운영 기간이 저장할 수 있는 상태인지. 저장할 수 없는 이유가 있으면 그 문장을, 없으면 null.
 *
 * <p>둘 다 비어 있는 것은 흠이 아니다 — 아직 기간을 정하지 않은 커리큘럼이 있다. 반쪽만 채운
 * 상태를 막는 이유는 시작·종료가 쌍으로만 뜻이 생기기 때문이고(카드는 "8월 3일 – 9월 24일"로
 * 읽는다), 과거 종료일을 막는 규칙은 생성 화면과 같게 둔다 — 두 화면이 다르면 만들 때는 거절당한
 * 기간을 수정으로는 넣을 수 있다.
 */
function describePeriodIssue({ startsAt, endsAt }: CurriculumPeriodValue): string | null {
  if (!startsAt && !endsAt) return null
  if (!startsAt || !endsAt) return '운영 시작일과 종료일을 함께 입력해 주세요. 한쪽만 저장할 수 없어요.'
  if (isDateBeforeToday(endsAt)) return '운영 종료일은 오늘보다 이전일 수 없습니다.'
  if (startsAt > endsAt) return '운영 종료일은 시작일보다 빠를 수 없습니다.'
  return null
}
type SectionInfoField = 'title' | 'description'
interface DraggedLesson {
  sectionId: string
  lessonId: string
}
interface LessonDropTarget {
  sectionId: string
  lessonIndex: number
}

function normalizeLegacySectionDescription(description: string) {
  const legacyValue = description.match(/^설명을 입력해\s*(.*?)\s*주세요\.$/)
  return legacyValue ? legacyValue[1].trim() : description
}

export default function CurriculumManagePage() {
  const { curriculumId } = useParams()
  const location = useLocation()
  const routeState = location.state as CurriculumDraftState | null
  /*
    탭은 URL 쿼리에 둔다. 재seed(key 교체)로 리셋되지 않아야 하고 — 일괄 게시나 강의 삭제 뒤에
    보고 있던 탭에서 계속 작업할 수 있어야 한다 — 그와 별개로 "수강생 탭으로 이동"을 링크로
    표현할 수 있어야 한다(알림 클릭이 그 링크를 쓴다). 로컬 state로는 두 번째가 불가능하다.
  */
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get(curriculumManageParams.tab)
  const tab = isManageTab(tabParam) ? tabParam : DEFAULT_MANAGE_TAB
  const setTab = (next: CurriculumManageTab) => {
    const params = new URLSearchParams(searchParams)
    params.set(curriculumManageParams.tab, next)
    // 다른 탭으로 나가면 수강생 탭 딥링크 조건(필터·강조 대상)은 의미가 없다.
    if (next !== 'enrollees') {
      params.delete(curriculumManageParams.enrollmentStatus)
      params.delete(curriculumManageParams.highlightEnrollment)
    }
    // 탭 전환은 뒤로 가기 이력을 남기지 않는다 — 같은 화면 안의 내용 교체다.
    setSearchParams(params, { replace: true })
  }
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
  /*
    RequireRoleRoute는 "강사인가"만 본다 — 남의 커리큘럼인지는 서버만 안다. 소유자가 아니면
    서버가 403 CURRICULUM_FORBIDDEN을 주는데(NotCurriculumOwnerException), 이걸 일반 오류로
    묶으면 "잠시 후 다시 시도해 주세요"가 떠서 권한 문제를 일시 장애처럼 읽게 된다.
  */
  if (managementQuery.error instanceof ApiError && managementQuery.error.code === 'CURRICULUM_FORBIDDEN') {
    return <Navigate to={publicPaths.forbidden('ownership')} replace />
  }
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
    enrollmentStatusFilter={searchParams.get(curriculumManageParams.enrollmentStatus)}
    highlightEnrollmentId={searchParams.get(curriculumManageParams.highlightEnrollment)}
  />
}

function CurriculumManageEditor({
  curriculumId,
  routeState,
  storedCurriculum,
  initialSections,
  tab,
  onTabChange,
  enrollmentStatusFilter,
  highlightEnrollmentId,
}: {
  curriculumId: string
  routeState: CurriculumDraftState | null
  storedCurriculum: InstructorCurriculumResponse
  initialSections: CurriculumManagementSection[]
  tab: CurriculumManageTab
  onTabChange: (tab: CurriculumManageTab) => void
  /** 알림 등 딥링크가 지정한 수강생 목록의 초기 상태 필터. */
  enrollmentStatusFilter: string | null
  /** 딥링크가 지정한 강조 대상 수강 신청. */
  highlightEnrollmentId: string | null
}) {
  const isNewDraft = storedCurriculum?.lifecycleStatus === 'DRAFT'
  const lifecycleView = LIFECYCLE_VIEW[storedCurriculum.lifecycleStatus]
    ?? { tone: 'neutral' as const, label: storedCurriculum.lifecycleStatus, description: '알 수 없는 상태입니다.' }
  // 이전 화면이 placeholder 문구를 실제 값으로 저장한 레코드도 빈 설명으로 복구해 보여 준다.
  // 사용자가 다른 내용을 수정하면 자동 저장 과정에서 빈 문자열로 정리된다.
  const [sections, setSections] = useState(() => initialSections.map((section) => ({
    ...section,
    description: normalizeLegacySectionDescription(section.description),
  })))
  useEffect(() => {
    setSections((current) => {
      let changed = false
      const normalized = current.map((section) => {
        const description = normalizeLegacySectionDescription(section.description)
        if (description === section.description) return section
        changed = true
        return { ...section, description }
      })
      return changed ? normalized : current
    })
  }, [initialSections])
  // structureVersion을 로컬로 들고 저장 때마다 갱신한다 — 안 그러면 새로고침 없이 연속 저장 시
  // 낡은 baseVersion을 보내 409로 실패한다(order PUT의 낙관적 동시성).
  const [structureVersion, setStructureVersion] = useState(storedCurriculum.structureVersion)
  const [curriculumInfo, setCurriculumInfo] = useState({
    title: routeState?.draft?.title ?? storedCurriculum?.title ?? '',
    summary: routeState?.draft?.summary ?? storedCurriculum?.summary ?? '',
    description: routeState?.draft?.description ?? storedCurriculum?.description ?? '',
  })
  /*
    기간은 date 입력이 받는 지역 날짜 문자열로 들고 있다가 저장할 때 일 경계 ISO로 바꾼다.
    서버가 준 ISO를 그대로 input에 넣으면 값이 표시되지 않는다.
  */
  const [period, setPeriod] = useState<CurriculumPeriodValue>({
    startsAt: toLocalDateInputValue(routeState?.draft?.startsAt ?? storedCurriculum?.startsAt),
    endsAt: toLocalDateInputValue(routeState?.draft?.endsAt ?? storedCurriculum?.endsAt),
  })
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(routeState?.draft?.thumbnailUrl ?? storedCurriculum?.thumbnailUrl ?? null)
  const [materials, setMaterials] = useState<CurriculumMaterial[]>(routeState?.draft?.materials ?? storedCurriculum.materials)
  const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved' | 'error'>(routeState?.created ? 'saved' : 'idle')
  const toast = useToast()
  /*
   * 저장 실패는 <b>토스트로</b> 알린다. 예전에는 요약 툴바 위에 inline-notice를 끼워 넣었는데, 그
   * 한 줄이 들어오고 나갈 때마다 아래 전체가 59px씩 오르내렸다 — 자동 저장은 편집 중(디바운스 1초)에
   * 도는 것이라 <b>글을 쓰고 있는 손 밑에서</b> 화면이 튄다.
   *
   * 자동으로 닫지 않는다(duration 0). "새로고침한 뒤 다시 시도해 주세요" 같은 복구 방법이 담긴
   * 문장이라 3초 뒤에 사라지면 읽지 못한 사람이 생긴다. 대신 저장이 다시 성공하면 우리가 치운다.
   *
   * 같은 문구가 반복될 때 쌓지 않는다 — 서버가 계속 죽어 있으면 편집할 때마다 한 장씩 늘어난다.
   */
  const saveErrorToastRef = useRef<{ id: number; message: string } | null>(null)
  const reportSaveError = useCallback((message: string) => {
    if (saveErrorToastRef.current?.message === message) return
    if (saveErrorToastRef.current) toast.dismiss(saveErrorToastRef.current.id)
    saveErrorToastRef.current = { id: toast.error(message, 0), message }
  }, [toast])
  const clearSaveError = useCallback(() => {
    if (!saveErrorToastRef.current) return
    toast.dismiss(saveErrorToastRef.current.id)
    saveErrorToastRef.current = null
  }, [toast])
  const [draggedLesson, setDraggedLesson] = useState<DraggedLesson | null>(null)
  const [lessonDropTarget, setLessonDropTarget] = useState<LessonDropTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isStructureTabsDocked, setIsStructureTabsDocked] = useState(false)
  const navigate = useNavigate()
  const manageTabsOriginRef = useRef<HTMLDivElement>(null)

  const queryClient = useQueryClient()
  const structureVersionRef = useRef(structureVersion)
  structureVersionRef.current = structureVersion
  // 저장 중 여부와, 저장 도중 들어온 변경을 기억해 저장이 끝나면 한 번 더 돌린다(마지막 변경까지 반영).
  const savingRef = useRef(false)
  const dirtyAfterSaveRef = useRef(false)
  // 서버에 이미 반영된 상태의 서명. 이 서명과 같으면 저장을 건너뛴다. 섹션 자체 id는 저장 후
  // 임시→실제로 바뀌므로 서명에서 제외한다(내용·순서만 본다) — 그래야 id 교체가 재저장을 유발하지 않는다.
  const savedSignatureRef = useRef<string | null>(null)

  const periodIssue = describePeriodIssue(period)
  /**
   * PATCH에 실을 기간. <b>저장할 수 없는 상태면 두 값을 null로 보낸다</b> — 서버가 null을 "변경
   * 안 함"으로 다루므로, 기간을 고치는 중에도 제목·소개 자동 저장이 멈추지 않는다. 기간만 반영이
   * 미뤄지고, 유효해지는 순간 지문이 바뀌어 저장된다.
   *
   * <p>그래서 <b>저장된 기간을 다시 비우는 것은 이 화면으로 할 수 없다</b>(대표 이미지 삭제와 같은
   * 자리 — null이 삭제가 아니라 무변경이라서다). 기간을 없애는 계약이 생기면 여기서 연결한다.
   */
  const periodPatch = useMemo(() => (periodIssue
    ? { startsAt: null, endsAt: null }
    : {
        startsAt: toIsoAtStartOfDayOrNull(period.startsAt),
        endsAt: toIsoAtEndOfDayOrNull(period.endsAt),
      }
  ), [periodIssue, period.startsAt, period.endsAt])

  // 자료는 fileName:fileSize로 지문을 만든다 — 새로 올린 자료의 임시 id·File이 저장 후 실제
  // materialId로 바뀌어도 지문이 안정적이라(섹션 id를 지문에서 뺀 것과 같은 이유) 재저장 루프가 안 돈다.
  const currentSignature = useCallback(() => JSON.stringify({
    info: curriculumInfo,
    // 지문에는 "보낼 값"만 넣는다 — 반쪽 입력 상태의 타이핑이 저장을 부르지 않게.
    period: periodPatch,
    sections: sections.map((section) => ({
      title: section.title,
      description: section.description,
      lessons: section.lessons.map((lesson) => lesson.lessonId),
    })),
    materials: materials.map((material) => `${material.fileName}:${material.fileSize}`),
  }), [curriculumInfo, periodPatch, sections, materials])


  /**
   * 저장 결과를 이 화면을 그리는 쿼리 캐시에 반영한다.
   *
   * <p>여기가 없으면 <b>저장은 됐는데 화면만 옛것</b>이 된다. 저장 결과는 로컬 state에만 들어가고,
   * 다른 페이지로 나가면 그 state가 사라진 뒤 캐시(staleTime 30초)로 다시 그려지기 때문이다 —
   * 올린 자료가 사라져 보이고, 지운 자료가 되살아나 보이다가 30초가 지나서야 맞게 나왔다.
   *
   * <p><b>섹션은 캐시에 쓰지 않고 stale 표시만 한다.</b> 새 섹션이 실제 id를 받으면 재seed key가
   * 바뀌므로(위 CurriculumManagePage 참조) 지금 캐시에 쓰면 편집 중인 에디터가 리마운트돼 방금
   * 입력한 글자와 저장 배지가 날아간다. 다음 진입에서 서버를 다시 읽게만 해 두면 충분하다.
   */
  const syncCachedCurriculum = useCallback((
    apply: (current: InstructorCurriculumResponse) => InstructorCurriculumResponse,
  ) => {
    queryClient.setQueryData<{ curriculum: InstructorCurriculumResponse; sections: CurriculumManagementSection[] }>(
      ['curriculum-management', curriculumId],
      (current) => current && { ...current, curriculum: apply(current.curriculum) },
    )
    // refetchType: 'none' — 지금 도는 refetch는 리마운트를 부른다. 다음 진입에서 받게만 한다.
    queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId], refetchType: 'none' })
    // 제목·자료·대표 이미지는 이 화면 밖에서도 보인다(내 커리큘럼 카드, 공개 상세). 편집 중에는 그
    // 쿼리들이 비활성이라 stale 표시만 되고 요청은 나가지 않는다.
    queryClient.invalidateQueries({ queryKey: ['my-curriculums'] })
    queryClient.invalidateQueries({ queryKey: ['curriculums'] })
  }, [curriculumId, queryClient])

  const syncCacheAfterSave = useCallback((result: SaveCurriculumManagementResult) => {
    syncCachedCurriculum((current) => ({
      ...current,
      ...curriculumInfo,
      // 보내지 않은 기간(null)은 서버에서도 그대로이므로 캐시의 기존 값을 지키다.
      startsAt: periodPatch.startsAt ?? current.startsAt,
      endsAt: periodPatch.endsAt ?? current.endsAt,
      materials: result.materials,
      structureVersion: result.structureVersion,
    }))
  }, [curriculumInfo, periodPatch, syncCachedCurriculum])

  // 구조·기본정보·자료 자동저장(ADR-0042). 자료 추가/삭제도 지문에 반영돼 자동저장이 돈다 —
  // saveCurriculumManagement가 새 자료 업로드·연결과 사라진 자료 삭제를 함께 처리한다.
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
    try {
      const result = await saveCurriculumManagement({
        curriculumId,
        info: { ...curriculumInfo, ...periodPatch },
        sections,
        // 커리큘럼-레벨 자료(ADR-0042). 새로 선택한 자료는 업로드·연결되고 사라진 자료는 삭제된다.
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
      // 저장된 자료(실제 materialId, File 없음)로 맞추되, 저장이 도는 동안 새로 고른 파일은 남긴다
      // (ADR-0077). 통째로 덮으면 그 선택이 조용히 사라졌다. 지문이 fileName:fileSize라 서버 자료로의
      // 교체 자체는 재저장을 유발하지 않고, 남은 대기 항목만 다음 디바운스에서 저장된다.
      setMaterials((current) => mergeCurriculumMaterials(result.materials, current))
      setStructureVersion(result.structureVersion)
      savedSignatureRef.current = signature
      setAutosave('saved')
      clearSaveError()   // 다시 저장됐다 — 떠 있던 실패 토스트를 치운다
      syncCacheAfterSave(result)
      // 사이드바 등 다른 화면이 최신 구조를 읽도록.
      queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] })
      return true
    } catch (error) {
      setAutosave('error')
      if (error instanceof ApiError && error.code === 'STRUCTURE_VERSION_CONFLICT') {
        reportSaveError('구조가 다른 곳에서 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.')
      } else if (isNotImplemented(error)) {
        reportSaveError('아직 준비 중인 항목이 포함돼 저장하지 못했습니다.')
      } else if (error instanceof CurriculumMaterialSyncError) {
        /*
          자료가 일부만 붙은 채로 실패했다 — 붙은 것은 서버 목록에 있으므로 그 목록으로 맞추고 실패한
          파일만 대기로 남긴다(ADR-0077). 이 정리를 하지 않으면 다음 저장이 이미 붙은 자료를 지우고
          새 에셋으로 다시 올려(고아 파일) 같은 일을 반복한다.

          목록이 서버 기준으로 돌아가므로 이번에 지우려던 자료는 다시 보일 수 있다. 그게 실제 서버
          상태다 — 실패한 저장이 목록을 줄여 놓으면 무엇을 잃었는지 알 수 없다.
        */
        setMaterials((current) => mergeCurriculumMaterials(error.persistedMaterials, current))
        reportSaveError(`${error.message} 자료 목록은 서버 상태로 맞췄습니다.`)
      } else {
        reportSaveError('변경 내용을 자동 저장하지 못했습니다.')
      }
      return false
    } finally {
      savingRef.current = false
      if (dirtyAfterSaveRef.current) {
        dirtyAfterSaveRef.current = false
        void flushSave()
      }
    }
  }, [curriculumId, curriculumInfo, periodPatch, sections, materials, currentSignature, queryClient, syncCacheAfterSave,
    reportSaveError, clearSaveError])

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

  /*
    구성 탭의 원래 탭 자리가 헤더 아래에서도 완전히 보이지 않게 된 뒤에만 우측 게시 열로
    탭을 옮긴다. 원래 자리 래퍼는 높이를 유지하므로 도킹 전환 때 본문이 튀지 않는다.
    단일 열이 되는 화면에서는 우측 도킹의 의미가 없으므로 기존 탭 위치를 유지한다.
  */
  useEffect(() => {
    const origin = manageTabsOriginRef.current
    if (tab !== 'structure'
      || !origin
      || typeof window.matchMedia !== 'function'
      || typeof IntersectionObserver === 'undefined') {
      setIsStructureTabsDocked(false)
      return
    }

    const desktopQuery = window.matchMedia('(min-width: 961px)')
    let observer: IntersectionObserver | null = null
    const syncObserver = () => {
      observer?.disconnect()
      observer = null
      if (!desktopQuery.matches) {
        setIsStructureTabsDocked(false)
        return
      }

      observer = new IntersectionObserver(([entry]) => {
        setIsStructureTabsDocked(!entry.isIntersecting)
      }, {
        // 전역 헤더 아래(기존 sticky top)까지 탭이 사라진 시점을 기준으로 전환한다.
        rootMargin: '-82px 0px 0px 0px',
        threshold: 0,
      })
      observer.observe(origin)
    }

    syncObserver()
    desktopQuery.addEventListener('change', syncObserver)
    return () => {
      observer?.disconnect()
      desktopQuery.removeEventListener('change', syncObserver)
    }
  }, [tab])

  const updateCurriculumInfo = (field: CurriculumInfoField, value: string) => {
    setCurriculumInfo((current) => ({ ...current, [field]: value }))
  }

  /**
   * 대표 이미지를 교체한다 — <b>고른 즉시 저장</b>한다(ADR-0076).
   *
   * <p>디바운스 지문에 태우지 않는 이유는 두 가지다. 파일 선택은 타이핑처럼 이어지는 입력이 아니라
   * 한 번의 사건이고, 지문이 저장 전(파일 이름·크기)과 후(서버 URL)로 달라져 저장이 한 번 더
   * 도는 것을 막기 어렵다.
   *
   * <p>예전에는 고른 파일을 버리고 미리보기 URL만 로컬 state에 넣었다 — 화면은 "변경 사항이 자동
   * 저장됩니다"라고 말하는데 이미지는 어디에도 저장되지 않아, 다시 들어오면 옛 이미지로 돌아갔다.
   */
  const applyThumbnailSelection = async (selection: CurriculumImageSelection | null) => {
    /*
     * 지우는 것도 <b>같은 즉시 저장</b>이다. 다만 교체와 endpoint가 다르다 — 기본 정보 PATCH는
     * `thumbnailAssetId: null`을 "변경 안 함"으로 읽으므로 그 길로는 비울 수 없고, 서버가 그래서
     * `DELETE .../thumbnail`을 따로 둔다(멱등 204).
     */
    const previous = thumbnailUrl
    setThumbnailUrl(selection ? selection.previewUrl : null)   // 업로드를 기다리지 않고 먼저 보여 준다
    setAutosave('saving')
    try {
      let saved: InstructorCurriculumResponse
      if (selection) {
        const assetId = await uploadCurriculumThumbnail(selection.file)
        if (!assetId) throw new Error('THUMBNAIL_ASSET_MISSING')
        saved = await updateCurriculumThumbnail({
          curriculumId,
          thumbnailAssetId: assetId,
          thumbnailPreviewUrl: selection.previewUrl,
        })
      } else {
        saved = await deleteCurriculumThumbnail(curriculumId)
      }
      setThumbnailUrl(saved.thumbnailUrl)
      setAutosave('saved')
      clearSaveError()
      syncCachedCurriculum((current) => ({ ...current, thumbnailUrl: saved.thumbnailUrl }))
    } catch (error) {
      // 실패했으면 미리보기도 되돌린다 — 바뀐 채로 두면 저장된 것으로 읽힌다(지우기도 마찬가지다).
      setThumbnailUrl(previous)
      setAutosave('error')
      reportSaveError(error instanceof ApiError && error.code === 'CURRICULUM_STATE_CONFLICT'
        ? error.message
        : selection
          ? '대표 이미지를 저장하지 못했습니다. 다시 시도해 주세요.'
          : '대표 이미지를 삭제하지 못했습니다. 다시 시도해 주세요.')
    }
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
   * 초안 삭제. 공개된 커리큘럼은 수강 이력이 붙을 수 있어 서버가 409로 막는다(ADR-0001) — 보관으로 안내한다.
   * 삭제에 성공하면 이 화면이 가리키던 대상이 사라지므로 목록으로 되돌린다.
   */
  const removeCurriculum = async () => {
    if (!window.confirm(`초안 "${curriculumInfo.title || storedCurriculum.title}"을(를) 삭제할까요? 섹션과 강의도 함께 사라지며 되돌릴 수 없습니다.`)) return

    setIsDeleting(true)
    try {
      await deleteCurriculum(curriculumId)
      queryClient.removeQueries({ queryKey: ['curriculum-management', curriculumId] })
      queryClient.invalidateQueries({ queryKey: ['my-curriculums'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
      toast.success('커리큘럼을 삭제했습니다.')
      navigate(instructorPaths.curriculums, { replace: true })
    } catch (error) {
      toast.error(error instanceof ApiError && error.code === 'CURRICULUM_STATE_CONFLICT'
        ? '이미 공개된 커리큘럼은 삭제할 수 없어요. 먼저 보관 처리해 주세요.'
        : '커리큘럼을 삭제하지 못했습니다.')
      setIsDeleting(false)
    }
  }

  /**
   * 게시 카드의 주 동작 — 커리큘럼 하나만 공개 상태로 바꾼다.
   *
   * 예전에는 초안 강의를 먼저 일괄 게시한 뒤 커리큘럼을 공개하는 2단 오케스트레이션이었다
   * (ADR-0002). 레슨에서 초안 상태가 없어졌으므로(ADR-0005) 공개 축이 커리큘럼 하나로 줄었고,
   * 이 버튼을 누르는 순간 커리큘럼과 그 안의 모든 강의가 함께 공개된다.
   */
  /*
   * 공개 전환이 날아가 있는 동안 스위치를 잠그고 도는 표시를 띄우기 위한 상태.
   * 화면은 서버가 확인해 준 뒤에만 바뀐다 — 낙관적으로 먼저 옮기면 실패했을 때
   * 켜졌다 되돌아가는 순간이 생기고, 그 사이 사용자는 성공했다고 믿는다.
   */
  const [isChangingVisibility, setChangingVisibility] = useState(false)

  /** 공개를 내린다(보관). 되돌릴 수 있다 — 서버가 ARCHIVED에서 다시 공개를 받는다. */
  const runArchive = async () => {
    if (!isPubliclyVisible || isChangingVisibility) return
    if (!window.confirm('공개를 내릴까요? 카탈로그에서 사라져 새로 수강신청할 수 없습니다. 이미 듣던 수강생은 계속 볼 수 있고, 다시 공개할 수 있습니다.')) return

    setChangingVisibility(true)
    try {
      await archiveCurriculum(curriculumId)
      invalidateAfterPublish()
      toast.success('공개를 내렸습니다. 다시 공개할 수 있어요.')
    } catch (error) {
      // 서버가 거절한 이유가 가장 정확하다. 뭉개면 사용자가 같은 스위치를 계속 누른다.
      invalidateAfterPublish()
      toast.error(error instanceof ApiError ? error.message : '공개를 내리지 못했습니다.')
    } finally {
      setChangingVisibility(false)
    }
  }

  const runPublish = async () => {
    if (isPubliclyVisible || isChangingVisibility) return
    // 버튼이 잠겨 있어도 한 번 더 본다 — 낡은 화면 상태로 요청이 새는 것을 막는다.
    if (!publishReadiness.canPublish) {
      toast.error(publishReadiness.reason ?? '아직 게시할 수 없습니다.')
      return
    }
    if (!window.confirm('커리큘럼을 게시할까요? 게시하면 안에 있는 강의가 모두 수강생에게 공개됩니다.')) return

    // 저장이 실패한 채로 게시하면 화면에 보이는 내용과 공개되는 내용이 갈린다 — 게시를 멈춘다.
    if (!await flushSave()) {
      toast.error('변경 내용을 저장하지 못해 게시를 중단했습니다. 저장 오류를 먼저 해결해 주세요.')
      return
    }

    setChangingVisibility(true)
    try {
      await publishCurriculum(curriculumId)
      setAutosave('saved')
      invalidateAfterPublish()
      toast.success(`커리큘럼을 게시했습니다. 강의 ${totalLessonCount}개가 수강생에게 공개됩니다.`)
    } catch (error) {
      // 상태 충돌(이미 발행됨 등)은 서버 메시지가 원인을 정확히 말해준다 — 뭉개면 사용자가
      // 같은 버튼을 계속 누르게 된다. 재조회로 화면 상태도 정합시킨다.
      // 서버가 거절한 이유는 서버 메시지가 가장 정확하다(선행 조건 미충족·상태 충돌 모두).
      // 뭉개면 사용자가 같은 버튼을 계속 누른다.
      const serverExplained = error instanceof ApiError
        && (error.code === 'CURRICULUM_NOT_PUBLISHABLE' || error.code === 'CURRICULUM_STATE_CONFLICT')
      invalidateAfterPublish()
      toast.error(serverExplained ? (error as ApiError).message : '커리큘럼을 게시하지 못했습니다.')
    } finally {
      setChangingVisibility(false)
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
        description: '',
        order: current.length + 1,
        lessons: [],
      },
    ])
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

  // 게시 카드에서 "무엇이 공개되는지"를 보여 준다. 강의 수는 커리큘럼 전체 기준이고
  // 게시 선행 조건(섹션·강의 각 1개 이상, ADR-0006)도 이 값으로 판정한다.
  const allLessons = sections.flatMap((section) => section.lessons)
  const totalLessonCount = allLessons.length
  const publishReadiness = evaluatePublishReadiness(sections.length, totalLessonCount)
  // 공개 여부는 커리큘럼 상태만으로 결정된다(ADR-0005).
  const isPubliclyVisible = storedCurriculum.lifecycleStatus === 'PUBLISHED'
  const showDockedManageTabs = tab === 'structure' && isStructureTabsDocked
  const manageTabs = (
    <Tabs
      className="workspace-tabs curriculum-manage__tabs"
      idPrefix={MANAGE_TAB_PREFIX}
      label="커리큘럼 관리"
      items={MANAGE_TABS}
      value={tab}
      onChange={onTabChange}
    />
  )

  return (
    <div className="workspace-page curriculum-manage-page">
      <PageHeader
        title={curriculumInfo.title || '새 커리큘럼 초안'}
        description="기본 정보, 수강생, 섹션과 강의 편성을 관리합니다."
        action={<div className="header-action-group"><Link className="button button--soft" to={publicPaths.curriculum(curriculumId)}>커리큘럼 상세</Link><span className="autosave-status" role="status" aria-live="polite">{autosave === 'saving' ? '자동 저장 중…' : autosave === 'saved' ? '자동 저장됨' : autosave === 'error' ? '저장 실패' : '변경 사항이 자동 저장됩니다'}</span></div>}
      />
      <div className="curriculum-manage__toolbar">
        <div className="curriculum-manage__summary" role="group" aria-label="커리큘럼 관리 요약">
          <div><span>상태</span><StatusBadge tone={isPubliclyVisible ? 'success' : lifecycleView.tone}>{isNewDraft ? '게시 전' : isPubliclyVisible ? '운영 중' : lifecycleView.label}</StatusBadge></div>
          <div><span>섹션</span><strong>{sections.length}</strong></div>
          <div><span>전체 강의</span><strong>{totalLessonCount}</strong></div>
          <div><span>수강생</span><strong>{storedCurriculum.enrolleeCount ?? '--'}</strong></div>
        </div>
        <div className="curriculum-manage__tabs-origin" ref={manageTabsOriginRef}>
          {!showDockedManageTabs && manageTabs}
        </div>
      </div>

      {/* 구성 편집 중에도 공개 조건과 게시 동작을 확인할 수 있도록 게시 카드를 나란히 둔다. */}
      {tab === 'structure' && (
        <div className="workspace-tabpanel curriculum-manage__structure-tab" {...tabPanelProps(MANAGE_TAB_PREFIX, 'structure')}>
          <div className="curriculum-manage__structure-layout">
            <Panel className="curriculum-manage__structure-panel" title="섹션과 강의" description="강의를 드래그해 순서를 바꾸거나 다른 섹션으로 옮길 수 있습니다.">
              {/* 섹션마다 반복하지 않고 여기 한 번만 안내한다(삭제 제약 포함). */}
              <InlineNotice tone="info">새 섹션은 자동 저장된 뒤 라이브 강의를 만들거나 녹화강의를 업로드할 수 있어요. 강의가 있는 섹션은 비우거나 강의를 옮긴 뒤 삭제해 주세요.</InlineNotice>
              <div className="structure-list">
                {sections.map((section, sectionIndex) => (
                  <article className={`structure-section${lessonDropTarget?.sectionId === section.sectionId ? ' is-lesson-drop-target' : ''}`} key={section.sectionId}>
                    {/* 라벨·액션이 첫 줄, 입력창은 그 아래 전폭 — 버튼이 입력 폭을 깎지 않도록. */}
                    <header>
                      {/* 섹션에는 드래그 핸들을 두지 않는다 — 섹션 순서는 옆의 ↑↓ 버튼으로만 바꾸고,
                          잡아 끌 수 없는 자리에 핸들 모양을 두면 되지 않는 조작을 시도하게 만든다. */}
                      <span className="structure-section__eyebrow">SECTION {sectionIndex + 1}</span>
                      <div className="structure-section__fields">
                        <label><small>섹션 이름</small><input aria-label={`섹션 ${sectionIndex + 1} 이름`} maxLength={200} value={section.title} onChange={(event) => updateSection(section.sectionId, 'title', event.target.value)} /></label>
                        <label><small>섹션 설명</small><textarea aria-label={`섹션 ${sectionIndex + 1} 설명`} placeholder="설명을 입력해 주세요." rows={1} value={section.description} onChange={(event) => updateSection(section.sectionId, 'description', event.target.value)} /></label>
                      </div>
                      <div className="structure-actions">
                        <div className="structure-order-actions" aria-label="섹션 순서 변경">
                          <button className="button button--soft structure-order-button" aria-label="섹션 위로" title="섹션 위로 이동" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} type="button">
                            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 10 8 5.5l4.5 4.5" /></svg>
                          </button>
                          <button className="button button--soft structure-order-button" aria-label="섹션 아래로" title="섹션 아래로 이동" disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} type="button">
                            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 6 8 10.5 12.5 6" /></svg>
                          </button>
                        </div>
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
                        const detailPath = lesson.deliveryType === 'RECORDED'
                          ? instructorPaths.recordedLesson(curriculumId, section.sectionId, lesson.lessonId)
                          : instructorPaths.lesson(curriculumId, section.sectionId, lesson.lessonId)
                        const editPath = resolveInstructorLessonEditPath({
                          curriculumId,
                          sectionId: section.sectionId,
                          lessonId: lesson.lessonId,
                          deliveryType: lesson.deliveryType,
                        })
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
                            <div className="lesson-info">
                              <strong>{lesson.title}</strong>
                              {lesson.deliveryType === 'RECORDED' && <StatusBadge>녹화강의</StatusBadge>}
                            </div>
                            {/* 상태 배지는 없다 — 레슨 상태가 PUBLISHED 하나뿐이라 표시할 것이 없다(ADR-0005).
                                삭제도 여기 두지 않는다: 목록에서 한 번의 실수로 강의가 사라지던 자리라
                                수정 화면 안으로 옮겼다. */}
                            <div className="lesson-actions">
                              <div className="row-actions">
                                <Link to={detailPath}>상세</Link>
                                <Link to={editPath}>수정</Link>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                      {section.lessons.length === 0 && <li className="lesson-drop-empty" aria-hidden="true">강의를 이 섹션으로 드래그하세요.</li>}
                    </ul>
                    {/*
                      강의 추가는 목록 <b>아래 정중앙</b>에 둔다. 헤더 오른쪽에 있을 때는 섹션 자체를
                      다루는 버튼들(↑↓·섹션 삭제)과 한 줄에 섞여, 이 둘이 "섹션을 조작한다"가 아니라
                      "이 섹션에 강의를 이어 붙인다"라는 것이 위치로 드러나지 않았다. 마지막 강의(또는
                      빈 섹션 안내) 바로 밑이면 목록이 어디서 끝나고 무엇이 덧붙는지가 한눈에 읽힌다.
                    */}
                    <div className="structure-section__add-lesson">
                      {section.sectionId.startsWith('sec-new-')
                        ? <>
                            <button className="button button--soft button--small" type="button" disabled title="새 섹션이 자동 저장된 뒤에 녹화강의를 업로드할 수 있어요.">녹화강의 업로드</button>
                            <button className="button button--primary button--small" type="button" disabled title="새 섹션이 자동 저장된 뒤에 라이브 강의를 추가할 수 있어요.">라이브 강의 추가</button>
                          </>
                        : <>
                            <Link className="button button--soft button--small" to={instructorPaths.newRecordedLesson(curriculumId, section.sectionId)}>녹화강의 업로드</Link>
                            <Link className="button button--primary button--small" to={instructorPaths.newLesson(curriculumId, section.sectionId)}>라이브 강의 추가</Link>
                          </>}
                    </div>
                  </article>
                ))}
              </div>
              <button className="structure-add-section" type="button" onClick={addSection}>+ 섹션 추가</button>
            </Panel>

            <aside className={`curriculum-manage__publish-column${showDockedManageTabs ? ' curriculum-manage__publish-column--tabs-docked' : ''}`} aria-label="커리큘럼 게시 관리">
              {showDockedManageTabs && (
                <div className="curriculum-manage__tabs-dock">
                  {manageTabs}
                </div>
              )}
              <CurriculumPublishPanel
                isNewDraft={isNewDraft}
                lifecycleView={lifecycleView}
                totalLessonCount={totalLessonCount}
                readiness={publishReadiness}
                isPubliclyVisible={isPubliclyVisible}
                onPublish={() => void runPublish()}
                onArchive={() => void runArchive()}
                isChangingVisibility={isChangingVisibility}
                canDelete={isNewDraft}
                isDeleting={isDeleting}
                onDelete={() => void removeCurriculum()}
              />
            </aside>
          </div>
        </div>
      )}

      {/* 기본 정보와 자산을 한 화면에서 함께 확인한다. 게시는 구성 탭에서 분리해 다룬다. */}
      {tab === 'info' && (
        <div className="workspace-tabpanel curriculum-manage__info-grid" {...tabPanelProps(MANAGE_TAB_PREFIX, 'info')}>
          <Panel className="curriculum-manage__info-panel" title="기본 정보" description="제목과 수강생에게 표시할 소개를 수정합니다.">
            <div className="form-grid"><label><span>제목</span><input value={curriculumInfo.title} maxLength={200} placeholder="20자 안팎 권장" onChange={(event) => updateCurriculumInfo('title', event.target.value)} /></label><label><span>짧은 소개</span><input value={curriculumInfo.summary} onChange={(event) => updateCurriculumInfo('summary', event.target.value)} /></label><label className="form-field--wide"><span>상세 설명</span><textarea rows={4} value={curriculumInfo.description} onChange={(event) => updateCurriculumInfo('description', event.target.value)} /></label></div>
            {/*
              운영 기간을 여기 두는 이유: 카탈로그 카드와 상세가 이 값을 "8월 3일 – 9월 24일"로
              읽어 주고, 비어 있으면 "일정 준비 중"에 머문다. 제목·소개와 같은 기본 정보라 같은
              패널·같은 자동 저장에 태운다.
            */}
            <div className="curriculum-manage__embedded-period">
              <CurriculumPeriodFields
                idPrefix="manage-curriculum"
                value={period}
                onChange={(field, value) => setPeriod((current) => ({ ...current, [field]: value }))}
                showPreview={false}
              />
              {periodIssue && (
                <p className="curriculum-manage__period-issue" role="status">
                  {periodIssue} 나머지 기본 정보는 그대로 저장됩니다.
                </p>
              )}
            </div>

            <div className="curriculum-manage__embedded-image">
              <div>
                <h3>대표 이미지</h3>
                <p>목록과 상세 화면에서 커리큘럼을 구분하는 이미지입니다.</p>
              </div>
              <CurriculumImageField
                id="manage-curriculum-thumbnail"
                previewUrl={thumbnailUrl}
                onChange={(selection: CurriculumImageSelection | null) => void applyThumbnailSelection(selection)}
              />
            </div>
          </Panel>

          <Panel className="curriculum-manage__materials-panel" title="커리큘럼 강의 자료" description="전체 강의에서 공통으로 사용할 PPTX 자료를 관리합니다.">
            <CurriculumMaterialField
              id="manage-curriculum-materials"
              value={materials}
              onChange={updateMaterials}
              downloadRequest={(material) => ({
                scope: 'CURRICULUM',
                parentId: curriculumId,
                materialId: material.materialId,
                fileName: material.fileName,
                asInstructor: true,
              })}
            />
          </Panel>
        </div>
      )}

      {tab === 'enrollees' && (
        <div className="workspace-tabpanel" {...tabPanelProps(MANAGE_TAB_PREFIX, 'enrollees')}>
          <Panel className="curriculum-manage__enrollees-panel" title="수강 신청과 수강생" description="승인 대기, 수강 중, 종료된 수강 상태를 관리합니다.">
            <InstructorEnrollmentRoster
              curriculumId={curriculumId}
              initialStatus={enrollmentStatusFilter}
              highlightEnrollmentId={highlightEnrollmentId}
            />
          </Panel>
        </div>
      )}
    </div>
  )
}
