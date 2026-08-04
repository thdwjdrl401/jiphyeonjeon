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
       * <b>지금 이 창을 보고 있을 때만</b> 시스템 알림을 건너뛴다. 그때는 같은 알림이 STOMP로도
       * 가서 알림함이 바로 갱신되므로 두 번 알릴 이유가 없다.
       *
       * 예전에는 `visibilityState === 'visible'`로 봤는데 그게 너무 넓었다. 창이 다른 앱 뒤에
       * 떠 있기만 해도 'visible'이라, <b>딴 일 하는 중에는 알림이 하나도 안 왔다</b> — 푸시를
       * 쓰는 이유가 정확히 그 상황인데도. 활성 창이 아니면 무조건 띄운다.
       */
      const focused = clients.some((client) => client.focused)
      if (focused) return

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
