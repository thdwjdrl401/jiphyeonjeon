import { peekMockUser } from '@/features/auth/mockAuthService'
import {
  buildMockCurriculumOutline,
  deleteMockCurriculum,
  deleteMockLesson,
  deleteMockSection,
  getMockCurriculum,
  publishMockCurriculum,
  putMockCurriculum,
  updateMockCurriculumMaterials,
} from '@/features/demo/mockDatabase'
import { publishLiveCanceled } from '@/features/notification/mockNotificationEvents'
import { ApiError } from '@/shared/api/client'
import type { CurriculumManagementService } from './curriculumManagementService.interface'
import type { CurriculumMaterial } from './types'

const savedStructures = new Map<
  string,
  Awaited<ReturnType<CurriculumManagementService['getCurriculumManagementStructure']>>
>()

export interface MockRecordedLessonContext {
  lessonId: string
  title: string
  description: string
  curriculumId: string
  curriculumTitle: string
  sectionId: string
  sectionTitle: string
  materials: Array<{
    id: string
    name: string
    size: string
    status: string
    embeddingStatus: 'READY'
    keyTermStatus: 'READY'
  }>
}

const recordedLessons = new Map<string, MockRecordedLessonContext>()

export function getMockRecordedLesson(lessonId: string) {
  return recordedLessons.get(lessonId) ?? null
}

export function resetMockCurriculumManagement() {
  savedStructures.clear()
  recordedLessons.clear()
}

/**
 * "저장"된 자료로 정규화한다(HTTP 구현과 같은 계약) — File을 떼고, 새로 선택한(File 보유) 자료에는
 * 안정적인 persisted id를 부여한다. 그래야 저장 후 화면이 같은 파일을 다시 올리지 않는다.
 */
function persistMockMaterials(materials: CurriculumMaterial[] | undefined): CurriculumMaterial[] {
  return (materials ?? []).map((material) => ({
    materialId: material.file ? `mock-material-${material.fileName}-${material.fileSize}` : material.materialId,
    fileName: material.fileName,
    fileSize: material.fileSize,
  }))
}

export const mockCurriculumManagementService = {
  async uploadCurriculumThumbnail(file) {
    return `mock-thumbnail-${file.name}-${file.size}`
  },
  async createCurriculum(request) {
    const user = peekMockUser()
    if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
    if (user.role !== 'INSTRUCTOR') {
      throw new ApiError('강사만 커리큘럼을 만들 수 있어요.', 403, 'INSTRUCTOR_ROLE_REQUIRED')
    }
    const curriculum = putMockCurriculum(user, {
      title: request.title,
      summary: request.summary,
      description: request.description,
      thumbnailUrl: request.thumbnailPreviewUrl,
      materials: persistMockMaterials(request.materials),
      startsAt: request.startsAt,
      endsAt: request.endsAt,
    })
    return { curriculumId: curriculum.curriculumId, periodSaved: true }
  },
  async getInstructorCurriculum(curriculumId) {
    const curriculum = getMockCurriculum(curriculumId)
    if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')
    return {
      curriculumId: curriculum.curriculumId,
      title: curriculum.title,
      summary: curriculum.summary,
      description: curriculum.description,
      thumbnailUrl: curriculum.thumbnailUrl,
      lifecycleStatus: curriculum.lifecycleStatus,
      sectionCount: curriculum.sectionCount,
      lessonCount: curriculum.lessonCount,
      publishedLessonCount: buildMockCurriculumOutline(curriculum)
        .flatMap((section) => section.lessons)
        .filter((lesson) => lesson.status === 'PUBLISHED').length,
      structureVersion: 0,
      materials: curriculum.materials,
      enrolleeCount: curriculum.enrolleeCount,
    }
  },
  async getCurriculumManagementStructure(curriculumId) {
    const curriculum = getMockCurriculum(curriculumId)
    if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')
    const savedStructure = savedStructures.get(curriculumId)
    if (savedStructure) {
      return savedStructure.map((section) => ({
        ...section,
        lessons: section.lessons.map((lesson) => ({ ...lesson })),
      }))
    }
    return buildMockCurriculumOutline(curriculum).map((section) => ({
      sectionId: section.sectionId,
      title: section.title,
      description: section.description ?? '',
      order: section.order,
      lessons: section.lessons.map((lesson) => ({
        lessonId: lesson.lessonId,
        title: lesson.title,
        status: lesson.status,
        deliveryType: 'LIVE' as const,
      })),
    }))
  },
  async saveCurriculumManagement(request) {
    const curriculum = getMockCurriculum(request.curriculumId)
    if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')
    curriculum.title = request.info.title
    curriculum.summary = request.info.summary
    curriculum.description = request.info.description

    // 새 섹션에 실제 id를 부여(HTTP 구현과 동일 계약) — 저장 후 로컬 상태가 실제 id를 갖도록.
    const sectionIdMap: Record<string, string> = {}
    const persistedSections = request.sections.map((section) => {
      if (!section.sectionId.startsWith('sec-new-')) return section
      const realId = `sec-mock-${section.sectionId.slice('sec-new-'.length)}`
      sectionIdMap[section.sectionId] = realId
      return { ...section, sectionId: realId }
    })

    curriculum.sectionCount = persistedSections.length
    curriculum.lessonCount = persistedSections.reduce((count, section) => count + section.lessons.length, 0)
    const materials = persistMockMaterials(request.materials)
    updateMockCurriculumMaterials(request.curriculumId, materials)
    savedStructures.set(
      request.curriculumId,
      persistedSections.map((section) => ({
        ...section,
        lessons: section.lessons.map((lesson) => ({ ...lesson })),
      })),
    )
    return { structureVersion: request.structureVersion + 1, sectionIdMap, materials }
  },
  async publishCurriculum(curriculumId) {
    // 강의 상태는 그대로 둔다 — 실 서버와 같이 두 축은 독립이다(ADR-0002).
    publishMockCurriculum(curriculumId)
  },
  async deleteCurriculum(curriculumId) {
    deleteMockCurriculum(curriculumId)
    savedStructures.delete(curriculumId)
  },
  async deleteLesson(lessonId) {
    /*
      삭제 <b>전에</b> 알린다. 지운 뒤에는 강의 제목도, 어느 커리큘럼의 수강생에게 보내야 하는지도
      알 수 없다. 없는 강의를 지우려는 경우에는 알림도 만들어지지 않고(대상을 못 찾으므로)
      이어지는 `deleteMockLesson`이 실제 서버와 같은 404를 던진다.
    */
    publishLiveCanceled(lessonId)
    deleteMockLesson(lessonId)
    recordedLessons.delete(lessonId)
    for (const [key, structure] of savedStructures) {
      savedStructures.set(key, structure.map((section) => ({
        ...section,
        lessons: section.lessons.filter((lesson) => lesson.lessonId !== lessonId),
      })))
    }
  },
  async deleteSection(sectionId) {
    deleteMockSection(sectionId)
    for (const [key, structure] of savedStructures) {
      savedStructures.set(key, structure.filter((section) => section.sectionId !== sectionId))
    }
  },
  async uploadRecordedLesson(request) {
    const curriculum = getMockCurriculum(request.curriculumId)
    if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')

    const currentStructure = savedStructures.get(request.curriculumId)
      ?? buildMockCurriculumOutline(curriculum).map((section) => ({
        sectionId: section.sectionId,
        title: section.title,
        description: section.description ?? '',
        order: section.order,
        lessons: section.lessons.map((lesson) => ({
          lessonId: lesson.lessonId,
          title: lesson.title,
          status: lesson.status,
          deliveryType: 'LIVE' as const,
        })),
      }))
    if (!currentStructure.some((section) => section.sectionId === request.sectionId)) {
      throw new ApiError('섹션을 찾을 수 없습니다.', 404, 'SECTION_NOT_FOUND')
    }

    const lessonId = `lesson-recorded-${Date.now()}`
    const section = currentStructure.find((item) => item.sectionId === request.sectionId)!
    recordedLessons.set(lessonId, {
      lessonId,
      title: request.title,
      description: request.description,
      curriculumId: curriculum.curriculumId,
      curriculumTitle: curriculum.title,
      sectionId: section.sectionId,
      sectionTitle: section.title,
      materials: request.materials.map((file) => ({
        id: `mock-material-${file.name}-${file.size}`,
        name: file.name,
        size: file.size < 1024 * 1024
          ? `${Math.max(1, Math.round(file.size / 1024))} KB`
          : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        status: 'READY',
        embeddingStatus: 'READY',
        keyTermStatus: 'READY',
      })),
    })
    savedStructures.set(request.curriculumId, currentStructure.map((section) =>
      section.sectionId === request.sectionId
        ? {
            ...section,
            lessons: [...section.lessons, {
              lessonId,
              title: request.title,
              status: 'PUBLISHED',
              deliveryType: 'RECORDED' as const,
            }],
          }
        : section))

    return {
      lessonId,
      recordedVideoId: `recorded-${lessonId}`,
      jobId: `job-${lessonId}`,
      processingStatus: 'QUEUED' as const,
    }
  },
} satisfies CurriculumManagementService
