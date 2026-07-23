import { peekMockUser } from '@/features/auth/mockAuthService'
import {
  buildMockCurriculumOutline,
  getMockCurriculum,
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
    })
    return { curriculumId: curriculum.curriculumId }
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
    curriculum.sectionCount = request.sections.length
    curriculum.lessonCount = request.sections.reduce((count, section) => count + section.lessons.length, 0)
    updateMockCurriculumMaterials(request.curriculumId, request.materials)
    savedStructures.set(
      request.curriculumId,
      request.sections.map((section) => ({
        ...section,
        lessons: section.lessons.map((lesson) => ({ ...lesson })),
      })),
    )
  },
  async publishCurriculum(curriculumId) {
    const curriculum = getMockCurriculum(curriculumId)
    if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없습니다.', 404, 'CURRICULUM_NOT_FOUND')
    curriculum.lifecycleStatus = 'PUBLISHED'
    curriculum.catalogVisible = true
  },
} satisfies CurriculumManagementService
