import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getNotificationLeadTimes,
  getNotificationPreference,
  saveNotificationPreference,
} from './notificationService'

interface LiveReminderSettingProps {
  curriculumId: string
  /** 주면 <b>이 강의만</b> 덮어쓴다. 없으면 커리큘럼 전체 설정이다. */
  lessonId?: string
}

/**
 * 라이브 <b>곧 시작</b> 알림의 리드타임 설정. <b>내용만 그린다</b> — 제목과 패널 껍데기는 호출자가
 * 준다. 커리큘럼 상세는 형제들과 같은 {@code <section>} + {@code <h2>}를, 강의 상세는 {@code Panel}을
 * 쓰는데, 컴포넌트가 껍데기를 들고 있으면 한쪽에서 반드시 이중으로 겹친다.
 *
 * <p>이 설정이 다른 알림에는 영향을 주지 않는다는 것을 화면에서 밝힌다 — "알림 설정"이라고만 쓰면
 * 수강 승인·자료 게시까지 꺼지는 것으로 읽힌다. 그 둘은 사건이 일어난 순간의 통보라 리드타임이라는
 * 개념 자체가 없다.
 *
 * <p>선택지가 고정인 이유도 적는다. 서버가 이 값들에 맞춰 발화를 <b>미리 예약</b>해 두므로 임의
 * 값을 받을 수 없다 — 받으면 그 사람에게만 알림이 영영 오지 않는, 알아채기 어려운 고장이 된다.
 */
export function LiveReminderSetting({ curriculumId, lessonId }: LiveReminderSettingProps) {
  const queryClient = useQueryClient()
  const queryKey = ['notification-preference', curriculumId, lessonId ?? null] as const

  const leadTimesQuery = useQuery({
    queryKey: ['notification-lead-times'],
    queryFn: getNotificationLeadTimes,
    // 선택지는 배포 사이에 바뀌지 않는다. 화면을 옮길 때마다 다시 물을 이유가 없다.
    staleTime: Infinity,
  })
  const preferenceQuery = useQuery({
    queryKey,
    queryFn: () => getNotificationPreference(curriculumId, lessonId),
  })

  const save = useMutation({
    mutationFn: saveNotificationPreference,
    onSuccess: () => {
      /*
       * 커리큘럼 설정을 바꾸면 그 아래 강의들의 "적용값"도 달라질 수 있다(덮어쓰지 않은 강의는
       * 커리큘럼 값을 물려받는다). 그래서 이 한 건이 아니라 설정 전체를 무효화한다.
       */
      queryClient.invalidateQueries({ queryKey: ['notification-preference'] })
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
      <p className="live-reminder-setting__hint">
        라이브가 시작하기 전에 미리 알려 드립니다. 수강 승인·자료 등록 같은 다른 알림은 이 설정과
        무관하게 그대로 옵니다.
      </p>

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
            : '커리큘럼 설정을 따르고 있습니다. 바꾸면 이 강의에만 적용됩니다.'}
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

/** 1440분을 "1440분"이라고 보여 주지 않는다 — 사람이 읽는 단위로 바꾼다. */
function formatLead(minutes: number) {
  if (minutes >= 1440) return `${minutes / 1440}일`
  if (minutes >= 60) return `${minutes / 60}시간`
  return `${minutes}분`
}
