# ADR-0018: PK 전략 — uuid(v4) 도메인 / bigint identity 고빈도 하이브리드

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-17
- **관련**: [0005](0005-db-postgres-pgvector.md)(PG16+pgvector), [0017](0017-schema-ownership-core-ai.md)(스키마 경계)

## 맥락
모든 테이블의 PK 전략을 정해야 한다. 제약: FE 명세가 **ID를 URL·JSON에 노출**한다(`/lessons/{id}`). DB는 **PostgreSQL 16**(pgvector 이미지). "UUID PK는 인덱스가 나쁘다"는 통념이 있으나 이는 MySQL InnoDB 기준이다.

## 결정
PK를 **용도별 하이브리드**로 둔다.

| 유형 | PK | 대상 |
|---|---|---|
| **도메인 엔티티**(URL 노출) | `uuid DEFAULT gen_random_uuid()` (**v4**, 네이티브 16B) | app_user·curriculum·section·lesson·live_session·enrollment·material_asset·video_asset·bookmark·asset 등 |
| **고빈도 append 로그**(URL 비노출) | `bigint GENERATED ALWAYS AS IDENTITY` | chat_message·learning_progress·outbox_events (ai: document_chunk·chunk_embedding) |

- uuid는 **네이티브 `uuid` 타입**(16바이트)으로 저장한다. `varchar(36)` 문자열 저장 금지.

## 근거
- **URL 노출 → 추측 방지**: bigint 순차 PK를 노출하면 enumeration이 가능하다. uuid는 추측 불가. bigint를 쓰면 외부용 public_id를 또 만들어 이중 키가 된다.
- **v4를 고른 이유(v7 아님)**: 도메인 테이블은 전부 **저빈도**라 랜덤 삽입에 의한 인덱스 단편화 영향이 미미하다. v7은 시간정렬로 지역성이 좋지만 **생성시각이 ID에 노출**되고(URL로 생성시점 유추) 앱 생성 로직이 필요하며 **PG16엔 `uuidv7()`가 없다**(pg18+). 반면 v4는 시각 비노출 + `gen_random_uuid()` 네이티브 + 코드 0.
- **PG는 InnoDB 통념이 성립하지 않음**: InnoDB는 클러스터드 인덱스라 랜덤 UUID PK가 ① 행 저장을 단편화하고 ② 모든 세컨더리 인덱스에 PK를 복제한다. **PG는 힙 기반**이라 행은 대략 순차 저장되고, **세컨더리 인덱스는 PK가 아니라 TID(6B)를 참조**한다 → 두 고통이 모두 사라진다. 남는 비용은 PK 인덱스의 랜덤 삽입뿐인데, 저빈도 도메인이라 무시 가능.
- **고빈도는 bigint**: 대량 append(채팅·진도·outbox)는 순차 PK로 인덱스 지역성을 확보한다. "랜덤 삽입이 실제로 아픈 곳"만 bigint로 분리한 것.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **하이브리드 uuid(v4)/bigint(선택)** | 노출 안전 + 아픈 곳만 순차 | 규칙 두 개 |
| 전부 bigint | 인덱스 최소 | 순차 노출(enumeration) → public_id 이중키 |
| 전부 uuid v7 | 지역성 좋음 | 생성시각 노출, 앱 생성, PG16 미지원 |
| ULID | 정렬 + URL 친화 | 26B char, 비표준 타입 |

## 영향·후속
- 노출 규칙: **URL에 나가는 도메인 = uuid, 내부 로그 = bigint.**
- 특정 uuid 테이블이 **고빈도 삽입 + bigint 불가**로 판명되면 그 테이블만 **v7**(pg18 네이티브 또는 앱 생성) 재고. 현재는 해당 없음.
- 소셜 로그인 대비: `app_user.password_hash`는 지금 NOT NULL, 소셜 도입 시 `DROP NOT NULL`(즉시) + `user_identity` 테이블 추가.
