/*
 * Web Push 서비스워커.
 *
 * 탭이 닫혀 있어도 살아 있는 유일한 실행 맥락이라, 시스템 알림은 여기서만 띄울 수 있다.
 * 화면(useNotificationRealtime)은 탭이 열려 있을 때 STOMP 신호로 갱신하고, 이 파일은 그 반대편을
 * 맡는다 — 둘 다 오면 중복이 되므로 아래에서 화면이 떠 있는지 보고 시스템 알림을 건너뛴다.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    return // 우리가 보낸 형식이 아니다. 빈 알림을 띄우느니 아무것도 하지 않는다.
  }

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      /*
       * 화면이 떠 있고 사용자가 보고 있으면 시스템 알림을 띄우지 않는다 — 같은 알림이 STOMP로도
       * 가서 알림함이 이미 갱신된다. 두 층이 각자 닿는 대신 겹치는 구간만 여기서 정리한다.
       */
      const visible = clients.some((client) => client.visibilityState === 'visible')
      if (visible) return

      await self.registration.showNotification(payload.title ?? '새 알림', {
        body: payload.body ?? '',
        // 같은 태그는 덮어쓴다. 자료 열 개를 한꺼번에 올려도 알림이 열 개 쌓이지 않는다.
        tag: 'liveclass-notification',
        data: { url: payload.url ?? '/notifications' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/notifications'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // 이미 열린 탭이 있으면 새 창을 띄우지 않고 그 탭을 쓴다.
      const existing = clients.find((client) => 'focus' in client)
      if (existing) {
        await existing.focus()
        if ('navigate' in existing) await existing.navigate(url)
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
