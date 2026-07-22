# ADR-0024: aiintegration·learning 패키지는 배선 없는 스키마 골격으로 유지

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-22
- **관련**: [0017](0017-schema-ownership-core-ai.md)(core/ai 스키마 소유권), [0012](0012-hybrid-queue.md)(하이브리드 큐), [0018](0018-pk-strategy-uuid-bigint-hybrid.md)(PK 전략)

## 맥락
- master 리뷰에서 `com.liveclass.aiintegration`(`OutboxEvent`·`ExternalEventInbox` + `OutboxStatus`·`InboxStatus`)와 `com.liveclass.learning`(`LearningProgress`·`Bookmark`)이 **고아(orphan) 패키지**로 지적됐다. 엔티티만 있고 repository·service·web·이벤트 배선이 전혀 없어, 아무도 참조하지 않는다.
- `ModularityTests`(Spring Modulith)는 이걸 잡지 못한다. 모듈 경계 검증은 "잘못된 방향의 의존"을 찾는 도구라, **의존이 아예 없는** 패키지는 위반이 아니다. 즉 자동 게이트로는 영원히 드러나지 않고, 사람이 볼 때마다 "이거 배선된 건가?"를 다시 묻게 된다.
- 두 패키지의 성격은 서로 다르다.
  - **`aiintegration`** = Spring↔ai-worker AI 파이프라인의 **transactional outbox / 멱등 inbox**. [ADR-0017](0017-schema-ownership-core-ai.md)이 이 테이블들을 `core`(Spring 소유)로 확정했고, 발행 경로는 [ADR-0012](0012-hybrid-queue.md)의 하이브리드 큐(RabbitMQ 배치)를 탄다. DDL 주석도 명시적으로 **"CP2부터 활성"**이라고 적혀 있다(`core.outbox_events`, `core.external_event_inbox`).
  - **`learning`** = 학생별·레슨별 **진도**(이어보기 위치 `last_position_ms`, 유효 시청구간 `watched_ranges`, 90% 돌파 시 `completed_at`)와 **타임라인 북마크**. FE 학생 대시보드의 진행률·완료 레슨 수·이어보기가 지금은 목 데이터인데, 그 화면을 실데이터로 채우는 뒷단이 정확히 이 두 테이블이다.

## 결정
1. **두 패키지를 지금 상태(엔티티 + DDL 골격, 배선 없음) 그대로 유지한다.** 삭제하지 않고, 이번에 구현하지도 않는다.
2. 의도를 **코드 현장에서 보이게** 한다: `com.liveclass.aiintegration.domain`·`com.liveclass.learning.domain`에 한 줄짜리 `package-info.java`를 추가해 "배선 없는 스키마 골격, 이 ADR 참조"를 명시한다.
3. `@NamedInterface`는 **붙이지 않는다.** 두 패키지는 다른 모듈에 노출할 포트가 없다 — 노출할 게 생기는 시점(=배선하는 시점)에 `api` 패키지를 만든다.
4. 그때까지 두 패키지는 **스키마 계약(schema contract)으로만** 취급한다. 엔티티 필드는 DDL과 1:1로 유지하되, 비즈니스 로직·리포지토리·엔드포인트는 넣지 않는다.

## 근거
- **테이블이 이미 적용돼 있다.** `V1__init_core.sql`이 `core.learning_progress`·`core.bookmark`·`core.outbox_events`·`core.external_event_inbox`를 이미 만든다. 엔티티만 지우면 **주인 없는 테이블**이 남고, 테이블까지 없애려면 새 DROP 마이그레이션이 필요하다 — CP2에 되살릴 것을 알면서 지웠다 다시 만드는 순수한 churn이다.
- **`learning`은 먼 미래가 아니다.** 학생 진도·이어보기는 이미 FE 화면이 존재하는 근시일 기능이라, 지금 지우면 곧 같은 엔티티를 다시 쓰게 된다.
- **리뷰의 실제 불만은 "배선된 건지 모르겠다"는 모호함**이지 "코드가 존재한다"가 아니다. 그 모호함은 **의도를 문서화하면 해소**된다(이 ADR + `package-info`). 삭제는 문제를 해결하지 않고 정보를 잃는다.
- **지금 구현하는 건 근거가 없다.** outbox 릴레이는 상대편(ai-worker·RabbitMQ)이 CP2에 서야 의미가 있고, 검증할 대상이 없는 상태에서 만든 배선은 죽은 코드에 테스트 부담만 더한다.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **그대로 두기 + 의도 문서화 (선택)** | 스키마와 코드가 계속 일치, churn 0, CP2/학생기능 착수 비용 최소, 모호함은 ADR·package-info로 해소 | 당분간 "안 쓰는 코드"가 트리에 남음(리뷰마다 재확인 필요 → 이 ADR로 상쇄) |
| 지금 삭제 | 트리에서 미사용 코드 사라짐, 리뷰 노이즈 감소 | 주인 없는 테이블이 남거나 DROP 마이그레이션 추가 필요 → 되살릴 때 재작성, DDL 주석·[ADR-0017](0017-schema-ownership-core-ai.md)과 불일치 |
| 지금 구현(배선까지) | 고아 상태가 즉시 해소 | 상대편(ai-worker·큐)이 없어 검증 불가한 죽은 배선, CP1 범위 밖 작업·테스트 부담, 요구 확정 전 설계 고착 |

## 영향·후속
- **`learning` 배선**: 학생 진도·북마크 기능(진행률·완료 레슨 수·이어보기)을 착수할 때 repository/service/web + 계약 테스트와 함께 배선한다. 그때 `learning.api` 포트를 정의한다(대시보드 소비자용).
- **`aiintegration` 배선**: CP2 AI 파이프라인과 함께 **outbox 릴레이**(폴링 + `FOR UPDATE SKIP LOCKED` 선점 → RabbitMQ 발행)와 **inbox 컨슈머**(`(source, source_event_id)` 복합 PK 멱등 수신)를 배선한다.
- **그때까지의 취급**: 두 패키지는 스키마 계약 전용. 엔티티 변경은 마이그레이션과 짝으로만 하고, 배선이 없으므로 별도 계약 테스트는 두지 않는다.
- **모듈 경계**: 배선 시점에 `ModularityTests`가 비로소 유효해진다 — 특히 `learning`은 lesson·enrollment를 포트로만 참조해야 한다(엔티티 직접 참조 금지).
