import type { QueryClient } from '@tanstack/react-query'

/**
 * A lesson write changes every curriculum projection that contains that lesson.
 * Invalidate all viewer variants of the public detail as well as instructor views.
 *
 * <p><b>lessonId를 주면 그 강의 자신을 읽는 쿼리도 함께 무효화한다</b> — 수정 폼
 * (`instructor-lesson-form`), 라이브 강의 상세(`lesson`), 녹화강의 상세·수정(`recorded-lesson`).
 * 이들이 빠져 있어서 자료를 올리거나 지운 뒤 폼·상세를 다시 열면 staleTime(30초)이 지나기 전까지
 * 저장 전 목록이 그대로 보였다(ADR-0076). 강의 종류를 미리 알 필요가 없도록 셋을 모두 비운다 —
 * 없는 키를 비우는 건 무해하고, 종류를 분기하면 새 종류가 생길 때마다 여기가 조용히 뒤처진다.
 *
 * <p>부수 효과가 하나 더 있다. 수정 폼은 저장 후에도 화면에 남는데, 이 무효화가 부르는 refetch가
 * 로컬 자료 목록을 서버 진실로 되돌린다 — 그러지 않으면 방금 올린 파일이 계속 "업로드 대기"로
 * 남아 다시 저장할 때 <b>같은 자료가 한 번 더</b> 업로드·연결됐다.
 */
export async function invalidateAfterLessonWrite(queryClient: QueryClient, curriculumId: string, lessonId?: string) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] }),
    queryClient.invalidateQueries({ queryKey: ['curriculum-lesson-navigation', curriculumId] }),
    queryClient.invalidateQueries({ queryKey: ['instructor-curriculum', curriculumId] }),
    queryClient.invalidateQueries({ queryKey: ['curriculums'] }),
  ]
  if (lessonId) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ['instructor-lesson-form', lessonId] }),
      queryClient.invalidateQueries({ queryKey: ['lesson', lessonId] }),
      queryClient.invalidateQueries({ queryKey: ['recorded-lesson', lessonId] }),
    )
  }
  await Promise.all(invalidations)
}
