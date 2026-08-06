# ADR-0024: 학습 북마크 기능을 제품·계약·스키마에서 제거한다

> 📍 공유 계약: [../../CONTRACT.md](../../CONTRACT.md) · 학습 상태: [../../STATE_TRANSITIONS.md](../../STATE_TRANSITIONS.md) · 관련 UI 결정: [ADR-0019](0019-unified-learning-sidebar-and-caption-dock-preview.md)

- **상태**: 채택 — FE + BE + DB + 문서 반영 완료
- **일자**: 2026-08-06
- **대체 범위**: [ADR-0004](0004-live-media-rewind-and-permissions.md) 결정 8의 북마크 좌표,
  [ADR-0006](0006-vod-publication-review-and-learning.md) 결정 14,
  [ADR-0020](0020-student-live-dvr-playback-api.md)의 북마크 정렬 요구

## 맥락

북마크는 라이브와 다시보기의 `sessionMs` 위치를 저장하고 플레이어·타임라인에서 다시 이동하는
기능으로 구현돼 있었다. 이후 학습 흐름의 핵심을 자막·채팅·AI 근거 이동, 시청 구간 집계,
진행률과 재시청 히트맵에 집중하기로 하면서 북마크는 최종 제품 범위에서 제외됐다.

화면에서 버튼만 숨기면 `POST/DELETE .../bookmarks`, `learning-context.bookmarks`, 엔티티·테이블,
mock 서비스와 테스트가 살아 남아 지원되는 계약처럼 보인다. 제품에서 빼기로 한 기능은 모든
레이어에서 같은 변경으로 제거해야 한다.

## 결정

1. 라이브·다시보기 플레이어와 학습 사이드바에서 북마크 추가·목록·이동·삭제 UI를 제거한다.
2. `POST /api/lessons/{lessonId}/bookmarks`와
   `DELETE /api/lessons/{lessonId}/bookmarks/{bookmarkId}`를 제공하지 않는다.
3. `GET /api/lessons/{lessonId}/learning-context` 응답에서 `bookmarks` 필드를 제거한다.
4. BE `Bookmark` 도메인·repository·request DTO·service/controller 경로와 FE 서비스 interface·mock·HTTP
   구현을 함께 제거한다.
5. 이미 배포된 Flyway 이력 `V1__init_core.sql`은 수정하지 않고 새 `V37__drop_bookmark_table.sql`에서
   `core.bookmark` 테이블을 제거한다.
6. 진행률, 시청 구간(`watch-buckets`), 히트맵, 자막·채팅·질문·AI 근거의 `sessionMs` 시간축은
   북마크와 독립적이므로 그대로 유지한다.
7. 기존 북마크 데이터는 별도 이관하지 않는다. 기능을 다시 도입하려면 새 제품 결정, 새 계약과
   새 migration으로 설계한다.

## 근거

- **숨은 계약을 남기지 않는다.** UI만 제거하면 클라이언트·테스트·문서가 서로 다른 제품 범위를
  주장하게 된다.
- **학습 모델은 유지된다.** 북마크를 없애도 진행률과 시청 구간, 근거 이동은 각자의 저장 경로와
  시간축을 사용한다.
- **적용된 migration은 불변이다.** 초기 migration을 고치지 않고 새 버전에서 테이블을 내려 기존
  환경과 신규 환경이 같은 최종 schema에 도달하게 한다.
- **복구 비용을 암묵적으로 떠안지 않는다.** 제거한 데이터를 유지·이관하면 폐기 기능을 계속 운영하는
  셈이므로 별도 보존 요구가 없는 현재 범위에서는 삭제한다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| UI만 숨기고 API·DB 유지 | 되살리기 쉬움 | 미지원 기능의 계약·보안·유지보수 부담이 남음 |
| API만 유지하고 deprecated 표시 | 외부 소비자 전환 시간 확보 | 외부 소비자가 없는 내부 MVP에 이중 계약만 생김 |
| **전 계층 제거(선택)** | 제품 범위와 코드·계약·스키마가 일치 | 기존 북마크 데이터가 삭제됨 |

## 영향·검증

- `core.bookmark`와 관련 코드·문서·테스트를 제거하고 학습 계약 테스트는 진행률·시청 구간 경로만
  검증한다.
- 구 endpoint를 유지하는 호환 기간은 없다. 외부 공개 API가 아니라 팀 내부 MVP 계약이므로 같은
  변경에서 제거했다.
- 이 ADR은 이미 반영된 런타임 계약을 사후에 기록한 문서 정합화다. 이번 문서 브랜치 자체는 API를
  다시 변경하지 않는다.

