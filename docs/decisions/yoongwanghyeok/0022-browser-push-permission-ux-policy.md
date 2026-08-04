# ADR-0022: 브라우저 알림(Web Push) 권한 요청 UX 정책

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-04
- **관련**: [CONTRACT.md §알림 센터 · Web Push](../../CONTRACT.md), [ADR-0073(songjeongki, 알림 팬아웃 아키텍처)](../songjeongki/0073-notification-fanout-architecture.md)

## 맥락 (Context)

백엔드 Web Push API(VAPID 공개키·구독 등록/해제)는 이미 구현되어 있었고, 프론트가 `Notification`
권한을 언제·어떻게 요청하고 그 상태를 어디서 관리할지가 정해져 있지 않았다. 기존 구현은 헤더
알림 드롭다운(`NotificationBell`)에 "브라우저 알림 켜기/끄기"와 차단 안내를 함께 두고 있었는데,
이 자리는 매번 알림을 열 때마다 노출되어 상태 관리 창구로 적절하지 않았고, 페이지 진입과 권한
요청 시점을 분리하는 정책도 없었다.

또한 브라우저 알림 권한은 **계정이 아니라 브라우저 프로필·기기 단위**로 걸린다. 같은 브라우저에서
계정을 바꾸면 구독은 남아 있는데 서버의 소유자 행은 이전 사용자 것으로 남아, 화면은 "켜짐"인데
푸시는 엉뚱한 사람에게 가는 문제가 실제로 있었다(§`usePushSubscription.ts`의 기존 주석 참조).
로그아웃 시점의 정책도 비어 있었다.

## 결정 (Decision)

1. **사전 안내 후 사용자 동의로만 권한 요청**: 로그인·Web Push 지원·권한 `default`·이 브라우저에
   활성 구독 없음·알림 받을 가치가 있는 강의(수강 중 또는 운영 중) 있음, 다섯 조건이 모두 맞을
   때만 대시보드(`MyCurriculumsPage`)가 사이트 자체 안내 배너(`BrowserPushPrompt`)를 한 번 띄운다.
   `Notification.requestPermission()`은 배너의 "브라우저 알림 켜기" 클릭 시에만 부른다.
2. **"나중에"는 7일 스누즈, 지문 수집 없음**: 닫은 시각만 `localStorage`
   (`browserPushPromptStorage.ts`)에 남기고, 브라우저 지문(캔버스·폰트 목록 등) 같은 것은 만들지
   않는다. 판단 근거는 `Notification.permission`·`PushSubscription` 존재 여부·이 스누즈 시각
   셋뿐이다. 네이티브 권한창에서 거절된 경우는 `Notification.permission`이 `denied`가 되어 배너
   조건 자체가 막으므로 별도 처리하지 않는다.
3. **영구 설정은 전체 알림 페이지로 이관**: `NotificationsPage` 헤더 우측에 압축 토글
   `BrowserNotificationToggle`을 두고 켜짐·꺼짐·차단됨·지원하지 않음 네 상태를 전담한다. 큰
   카드로 상태를 풀어 설명하지 않는다 — 지원하지 않으면 스위치를 그대로 두고 회색으로
   비활성화하고(자리가 페이지마다 있다 없다 하지 않게), 차단됐으면 스크립트로 다시 물을 수
   없으므로 스위치 대신 "브라우저 알림 차단됨" 문구를 두고 그 문구를 누르면 차단 해제 방법을
   안내하는 작은 팝오버(`live-reminder-popover`와 같은 열기·닫기 규칙)가 열린다. "끄기"는
   브라우저 권한 회수가 아니라 이 기기의 서버 구독 해제이므로 접근성 이름을 "이 브라우저에서
   알림 받기"로 둔다.
4. **헤더 팝업은 목록 진입만 담당**: `NotificationBell` 드롭다운에서 켜기/끄기/차단 안내를 모두
   지운다. 다만 이 컴포넌트가 로그인 중 항상 마운트돼 있다는 성질은 그대로 이용해
   `usePushSubscription`을 계속 호출해, 화면을 옮길 때마다 이 브라우저 구독의 서버 쪽 소유자를
   지금 로그인한 사람 앞으로 맞추는 부수효과만 남긴다.
5. **로그아웃 시 서버 쪽 소유자만 즉시 해제**: 같은 문제의식으로 커밋 `235d8e68`("명시적 로그아웃
   때 이 기기의 푸시 구독을 끊는다", 송정기)이 이 ADR 작업과 같은 날 별도로 master에 먼저
   병합됐다. `AuthContext.logout()`이 `authService.logout()`을 부르기 전에
   `releasePushSubscription()`(`features/notification/releasePushSubscription.ts`)을 호출해
   서버의 구독 소유자 행만 지우고, 브라우저 구독 자체(엔드포인트)는 지우지 않는다 — 다음
   로그인(같은 사람이든 다른 사람이든)에서 `usePushSubscription`의 마운트 시점 재등록 로직이
   그대로 이어받아 다시 연결한다. 이 ADR은 그 구현을 그대로 채택하고, 처음에 독립적으로 작성했던
   동일 기능(`usePushSubscription.ts`의 `detachPushSubscriptionOwner()`)은 리베이스 과정에서
   중복으로 확인돼 제거했다.

## 근거 (Rationale)

- 방문 즉시 권한을 묻는 방식은 대부분 거절되고, 한 번 거절되면 그 브라우저에서는 사이트가 다시
  물을 방법이 없다(브라우저 표준 동작). 사전 안내로 이유를 설명한 뒤 명시적 동의를 받는 편이
  허용률과 신뢰 모두에서 낫다.
- 브라우저 지문 수집은 그 자체로 프라이버시 비용이자 별도 유지보수 대상이다. 이미 존재하는
  `Notification.permission`·`PushSubscription`·로컬 스누즈 시각만으로 정책이 충분히 성립한다.
- 상태 관리 창구를 하나(전체 알림 페이지)로 모으면 "지금 켜져 있나"를 여러 화면이 각자 다시
  판단할 필요가 없고, 헤더 팝업은 원래 목적(최근 알림 확인)에 집중한다.
- 로그아웃 시 서버 소유자만 지우고 브라우저 구독은 남기는 것은, 완전히 지우면 다음 로그인마다
  사용자가 권한을 다시 눌러야 하는 비용이 생기기 때문이다. 반대로 아무것도 안 지우면 로그아웃과
  다음 로그인 사이 짧은 창에 이전 계정 앞으로 푸시가 갈 수 있다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택안) 사전 안내 배너 + 전체 알림 페이지 영구 설정 | 거절률 낮음, 상태 창구 단일화 | 조건이 다섯 개라 구현·테스트가 다소 늘어남 |
| 페이지 진입 즉시 `requestPermission()` | 구현 단순 | 대부분 거절되고 이후 되돌릴 수 없어 전환율이 구조적으로 나쁨 |
| 브라우저 지문으로 "새 브라우저" 추적 | 계정 간 미세한 상태 구분 가능 | 프라이버시 비용, 지문 수집 자체가 별도 유지보수·법적 리스크를 만듦 |
| 로그아웃 시 브라우저 구독까지 완전 해제 | 로그아웃 후 잔여 연결이 전혀 없어 가장 단순 | 다음 로그인마다 권한 재요청이 필요해 사용성 저하 |

## 영향·후속 (Consequences)

- 신규: `BrowserPushPrompt.tsx`, `browserPushPromptStorage.ts`, `BrowserNotificationToggle.tsx`.
- 변경: `NotificationBell.tsx`(푸시 UI 제거, 부수효과만 유지), `MyCurriculumsPage.tsx`(배너 연결),
  `NotificationsPage.tsx`(헤더 우측에 압축 토글 연결). `AuthContext.tsx`의 로그아웃 시 소유자 해제
  호출은 이미 master에 있던 `releasePushSubscription()` 배선을 그대로 유지했다(새로 추가하지
  않음).
- `docs/CONTRACT.md` §알림 센터 · Web Push에 이 정책 요약과 이 ADR 링크를 반영했다.
- 목(mock) 모드는 `getPushPublicKey()`가 항상 `null`을 주므로 배너·설정 카드 모두 "지원하지 않음"
  상태로 숨겨진다 — 기존 푸시 목 설계(ADR 없음, `mockNotificationService.ts` 주석)와 동일한 전제다.
