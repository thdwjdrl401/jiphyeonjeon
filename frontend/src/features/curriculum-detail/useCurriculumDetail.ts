import { useQuery } from '@tanstack/react-query'
import type { AuthUser } from '@/features/auth/types'
import { materialRefetchInterval } from '@/features/material/materialStatus'
import { getCurriculumDetail } from './curriculumDetailService'

export function useCurriculumDetail(curriculumId: string, viewer?: AuthUser, enabled = true) {
  return useQuery({
    queryKey: ['curriculums', 'detail', curriculumId, viewer?.userId ?? 'guest'],
    queryFn: () => getCurriculumDetail(curriculumId, viewer),
    enabled: Boolean(curriculumId) && enabled,
    /*
     * 강사가 자료를 올리는 동안 이 화면을 열어 둔 수강생도 준비가 끝나는 걸 본다. 게스트·미수강자는
     * materials가 빈 목록으로 오므로(CONTRACT §2의 노출 게이트) 폴링이 아예 켜지지 않는다.
     */
    refetchInterval: (query) => materialRefetchInterval(query.state.data?.materials),
    refetchIntervalInBackground: false,
  })
}
