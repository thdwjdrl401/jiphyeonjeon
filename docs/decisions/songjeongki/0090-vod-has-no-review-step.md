# ADR-0090: 영상에는 검수 단계를 두지 않는다 — 말과 코드를 맞춘다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-07
- **관련**: [choinhoo/0007](../choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)(자동 게시 — **이 결정의 원본**),
  [0034](0034-egress-completion-webhook.md)(Egress 완료 webhook),
  [0020](0020-egress-recording-lifecycle.md)(녹화 생명주기),
  `docs/CONTRACT.md` §다시보기
- **오너 경계**: BE(송정기) — 상태·계약 / FE — 문구

## 맥락

**코드는 자동 공개인데 화면과 문서는 "검수하고 게시한다"고 말하고 있었다.**

```java
// RecordingService.markReady — Egress 완료 webhook 한 트랜잭션에서
asset.setStatus(READY);
if (asset.getReplayStatus() == DRAFT) {
    asset.setReplayStatus(PUBLISHED);
    asset.setPublishedBy(null);        // 시스템 자동 게시
}
```

그런데 말은 전부 반대였다.

| 위치 | 문구 |
|---|---|
| 처리 현황 안내 | "아직 수강생에게 공개하지 않았습니다. **검수 후 게시하세요**" |
| 버튼 | `[VOD 미리보기·검수]` |
| 다시보기 화면 배지 | `강사 검수 모드` · `강사 미리보기` |
| 사용자 매뉴얼 | "[VOD 미리보기·검수]에서 확인 후 공개" |

**운영 데이터를 전수 확인했다.**

```
replay_status | video_asset status | 건수
PUBLISHED     | READY              | 30
DRAFT         | FAILED             |  2
```

`READY + DRAFT`가 **하나도 없다.** 즉 저 안내 문구는 틀린 정도가 아니라 **한 번도 참인 적이 없었다** —
그것이 뜨는 조건에 도달한 자산이 없다. `WITHDRAWN`도 0건이라 철회도 실제로 쓰인 적이 없다.

그리고 `READY_FOR_REVIEW`는 **어디서도 설정되지 않는다.**

```
setReplayStatus 호출 지점 전부:
  RecordingStartStore    → DRAFT
  RecordingService       → PUBLISHED   (자동)
  ReplayPublicationService → PUBLISHED (수동) · WITHDRAWN
```

값이 남아 있는 동안 enum·계약 문서·FE 타입·알림 라우팅·목 데이터가 전부 그것을 다뤘고, 읽는 사람은
"검수 흐름이 있는데 아직 안 켰나 보다"라고 이해했다. 그래서 문구가 고쳐지지 않았다.

## 결정 1 — 영상 검수를 넣지 않는다

자동 공개를 유지한다. 검수 게이트를 세우지 않는다.

- **라이브는 이미 공개된 것이다.** 학생이 실시간으로 다 봤다. 녹화는 그 사본이라, 실시간에 보여 준
  것을 녹화만 다시 검수한다는 축이 성립하지 않는다.
- **잊는 비용이 사고 비용보다 크다.** 검수를 잊으면 **100% 학생이 못 본다**. 사고 녹화(빈 화면·잘못
  공유한 화면)는 드물고 철회로 복구된다. 자동 공개로 바꾼 이유가 원래 그것이다(choinhoo/0007).
- **되돌릴 수단이 이미 있다.** 철회가 구현돼 있고 라이브 중에는 막혀 있다.

## 결정 2 — `READY_FOR_REVIEW`를 뺀다

enum·계약·FE 타입에서 지운다. 저장된 적이 없으므로 데이터 마이그레이션이 필요 없다.

**DB의 `CHECK` 제약은 그대로 둔다.** 값 하나를 더 허용하는 것은 무해하고, 살아 있는 테이블의 제약을
바꾸려면 마이그레이션 번호를 하나 더 쓴다 — 이 저장소에서 Flyway 번호 충돌이 두 번 사고를 냈다.
얻는 것에 비해 위험하다. 나중에 다른 마이그레이션을 쓸 일이 생기면 그때 함께 정리한다.

## 결정 3 — 문구를 현실에 맞춘다

검수가 없으므로 "검수"·"미리보기"라고 하지 않는다. **강사가 보고 있는 것은 학생이 지금 보는 그
화면**이고, 그 사실을 그대로 말하는 편이 정확하다.

| 전 | 후 |
|---|---|
| `강사 검수 모드` | `강사 화면` |
| `게시 완료` / `강사 미리보기` | `공개 중` / `비공개` |
| `[VOD 미리보기·검수]` | `[다시보기 확인]` |
| "아직 공개하지 않았습니다. 검수 후 게시하세요." | "지금은 수강생에게 보이지 않습니다. 다시보기 화면에서 공개할 수 있습니다." |

수동 `publish`는 **이름과 달리 재게시**다. `READY`를 요구하는데 `READY`가 되는 순간 자동으로
`PUBLISHED`가 되므로, 이 API가 실제로 하는 일은 내렸다 다시 올리는 것과 실패해 `DRAFT`에 남은 자산을
살리는 것뿐이다. API 이름은 바꾸지 않았다 — 계약 변경이라 얻는 것보다 비용이 크고, 주석과 계약
문서에 적어 두면 읽는 사람이 오해하지 않는다.

## 남겨 둔 것

**업로드 강의에는 철회가 없다.** 라이브 VOD는 `DRAFT|PUBLISHED|WITHDRAWN`인데 업로드 강의는
`DRAFT|PUBLISHED`뿐이고 둘 다 자동 공개다. 강사에게는 "라이브 녹화는 내릴 수 있는데 업로드 강의는
못 내린다"로 보인다. 설명 가능한 차이가 아니지만, 이번 변경은 **말과 코드를 맞추는 것**이 범위라
여기서 상태 축을 늘리지 않았다. 별도로 다룬다.

**AI 산출물 검수는 없다.** 자막·노트·용어는 만들어진 대로 학생에게 나가고, 강사가 고칠 수단이
용어(`GlossaryReviewModal`, 라이브 **전**)뿐이다. 계약 문서는 "AI 산출물의 검수·게시 상태는 이 자동
게시에 포함하지 않는다"고 **별개 축이라고 선언만** 해 두었고 구현이 없다. 영상에 게이트를 세우는
것보다 이쪽이 실제 위험이다 — 잘못된 용어 설명이 그대로 학생에게 간다. 후속으로 다룬다.

## 검증

| 확인 | 방법 |
|---|---|
| 저장된 `READY_FOR_REVIEW`가 없다 | 운영 DB 전수(32건) — PUBLISHED 30 / DRAFT 2(전부 FAILED) |
| 타입에서 사라져도 컴파일된다 | `compileJava` · `tsc --noEmit` |
| 공개 전 안내가 "검수"라고 하지 않는다 | `liveSessionProcessing.test.tsx` — `/검수/`가 화면에 없음을 못 박는다 |
| 강사 화면 배지 | `RouteSmoke.test.tsx` — `강사 화면` |
| 회귀 | BE Replay·Recording·Modularity·notification / FE 1120개 |
