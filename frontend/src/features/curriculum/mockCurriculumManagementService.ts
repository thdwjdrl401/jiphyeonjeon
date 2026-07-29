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
import { ApiError } from '@/shared/api/client'
import type { CurriculumManagementService } from './curriculumManagementService.interface'

const savedStructures = new Map<
  string,
  Awaited<ReturnType<CurriculumManagementService['getCurriculumManagementStructure']>>
>()

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
      materials: request.materials,
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
    updateMockCurriculumMaterials(request.curriculumId, request.materials)
    savedStructures.set(
      request.curriculumId,
      persistedSections.map((section) => ({
        ...section,
        lessons: section.lessons.map((lesson) => ({ ...lesson })),
      })),
    )
    return { structureVersion: request.structureVersion + 1, sectionIdMap }
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
    deleteMockLesson(lessonId)
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
} satisfies CurriculumManagementService
