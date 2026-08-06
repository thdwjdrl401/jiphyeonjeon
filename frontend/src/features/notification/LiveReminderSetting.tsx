import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import type { UserRole } from '@/features/auth/types'
import { getNotificationLeadTimes, saveNotificationPreference } from './notificationService'
import { notificationQueryKeys, useNotificationPreferenceQuery } from './useNotificationQueries'

interface LiveReminderSettingProps {
  curriculumId: string
  /** 주면 이 강의만 덮어쓰고, 없으면 커리큘럼 전체 설정을 바꾼다. */
  lessonId?: string
}

/**
 * 라이브 <b>곧 시작</b> 알림의 리드타임 설정 내용. 제목과 팝오버 껍데기는
 * {@code LiveReminderPopover}가 맡는다.
 *
 * <p>안내 문구는 역할별로 다르다. 이 화면은 강사와 수강생이 함께 쓰는데, 두 사람이 미리 알림을
 * 켜는 이유가 다르다 — 수강생은 라이브를 놓치지 않기 위해, 강사는 방송 준비 시간을 벌기 위해서다.
 * 수강생 쪽에는 이 설정이 다른 알림에 영향을 주지 않는다는 것도 밝힌다. "알림 설정"이라고만 쓰면
 * 수강 승인·자료 게시까지 꺼지는 것으로 읽힌다. 그 둘은 사건이 일어난 순간의 통보라 리드타임이라는
 * 개념 자체가 없다. 강사에게는 애초에 받을 일이 없는 알림이라 굳이 꺼내지 않는다.
 *
 * <p>선택지가 고정인 이유도 적는다. 서버가 이 값들에 맞춰 발화를 <b>미리 예약</b>해 두므로 임의
 * 값을 받을 수 없다 — 받으면 그 사람에게만 알림이 영영 오지 않는, 알아채기 어려운 고장이 된다.
 */
export function LiveReminderSetting({ curriculumId, lessonId }: LiveReminderSettingProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const leadTimesQuery = useQuery({
    queryKey: ['notification-lead-times'],
    queryFn: getNotificationLeadTimes,
    // 선택지는 배포 사이에 바뀌지 않는다. 화면을 옮길 때마다 다시 물을 이유가 없다.
    staleTime: Infinity,
  })
  const preferenceQuery = useNotificationPreferenceQuery(curriculumId, lessonId)

  const save = useMutation({
    mutationFn: saveNotificationPreference,
    onSuccess: () => {
      /*
       * 커리큘럼 설정을 바꾸면 그 아래 강의들의 "적용값"도 달라질 수 있다(덮어쓰지 않은 강의는
       * 커리큘럼 값을 물려받는다). 그래서 이 한 건이 아니라 설정 전체를 무효화한다.
       */
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.preferences })
    },
  })

  if (leadTimesQuery.isPending || preferenceQuery.isPending) {
    return <p className="notification-empty">알림 설정을 불러오는 중입니다.</p>
  }
  if (leadTimesQuery.isError || preferenceQuery.isError || !leadTimesQuery.data || !preferenceQuery.data) {
    return <p className="notification-empty">알림 설정을 불러오지 못했습니다.</p>
  }

  const { choices } = leadTimesQuery.data
  const preference = preferenceQuery.data
  const overridden = lessonId != null && preference.source === 'LESSON'

  return (
    <div className="live-reminder-setting">
      <p className="live-reminder-setting__hint">{LIVE_REMINDER_HINT[hintAudience(user?.role)]}</p>

      <label className="live-reminder-setting__toggle">
        <input
          type="checkbox"
          checked={preference.enabled}
          disabled={save.isPending}
          onChange={(event) =>
            save.mutate({
              curriculumId,
              lessonId,
              enabled: event.target.checked,
              leadMinutes: preference.leadMinutes,
            })
          }
        />
        미리 알림 받기
      </label>

      <label className="live-reminder-setting__lead">
        <span>얼마나 미리</span>
        <select
          value={preference.leadMinutes}
          disabled={!preference.enabled || save.isPending}
          onChange={(event) =>
            save.mutate({
              curriculumId,
              lessonId,
              enabled: preference.enabled,
              leadMinutes: Number(event.target.value),
            })
          }
        >
          {choices.map((minutes) => (
            <option key={minutes} value={minutes}>
              {formatLead(minutes)} 전
            </option>
          ))}
        </select>
      </label>

      {/*
        값이 어디서 왔는지 밝힌다. 강의 화면에서 30분이 보일 때 그게 이 강의만의 설정인지
        커리큘럼에서 내려온 것인지 모르면, 사용자는 자기가 무엇을 바꾸는지 알 수 없다.
      */}
      {lessonId != null && (
        <p className="live-reminder-setting__source">
          {overridden
            ? '이 강의만 다르게 설정되어 있습니다.'
            : preference.source === 'CURRICULUM'
              ? '커리큘럼 설정을 따르고 있습니다. 바꾸면 이 강의에만 적용됩니다.'
              : '기본 설정을 따르고 있습니다. 바꾸면 이 강의에만 적용됩니다.'}
        </p>
      )}

      {save.isError && (
        <p className="live-reminder-setting__error" role="alert">
          설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </div>
  )
}

const LIVE_REMINDER_HINT = {
  INSTRUCTOR: '라이브 시작 전에 미리 알려드립니다. 방송 준비를 놓치지 않도록 원하는 시간에 알림을 받을 수 있습니다.',
  VIEWER:
    '라이브가 시작하기 전에 미리 알려 드립니다. 수강 승인·자료 등록 같은 다른 알림은 이 설정과 무관하게 그대로 옵니다.',
} as const

/**
 * 강사 문구는 강사에게만 준다. 새 역할이 생기거나 역할을 아직 모를 때(로그인 정보 로딩 중)는
 * 수강생 문구로 떨어지는데, 이쪽이 더 넓은 설명이라 누가 읽어도 틀리지 않는다.
 */
function hintAudience(role: UserRole | undefined): keyof typeof LIVE_REMINDER_HINT {
  return role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'VIEWER'
}

/** 1440분을 "1440분"이라고 보여 주지 않는다 — 사람이 읽는 단위로 바꾼다. */
function formatLead(minutes: number) {
  if (minutes >= 1440) return `${minutes / 1440}일`
  if (minutes >= 60) return `${minutes / 60}시간`
  return `${minutes}분`
}
