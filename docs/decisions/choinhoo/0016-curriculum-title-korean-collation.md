# ADR-0016: 커리큘럼 제목 이름순은 컬럼 단위 ko-KR ICU 콜레이션을 사용한다

> 정본 규칙: [AGENTS.md](../../../AGENTS.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md) ·
> 판단 정책: [POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-05
- **관련**: CATALOG-01, `V36__curriculum_title_korean_collation.sql`

## 맥락 (Context)

커리큘럼 탐색의 `TITLE_ASC`는 프론트에서 정상 전달되고 백엔드도 `title ASC`를 적용했지만,
PostgreSQL의 DB 기본 콜레이션이 `en_US.utf8`이라 한글 제목이 가나다순으로 정렬되지 않았다. 프론트
Mock은 `localeCompare(..., 'ko')`를 사용해 실제 HTTP 모드와 결과가 달랐다.

커리큘럼 제목에는 한글과 영문이 모두 들어올 수 있다. 정렬은 한국어 UI 사용자가 기대하는 규칙을
따르되, 제목에 저장 가능한 언어를 제한해서는 안 된다. 또한 서버 페이지네이션 전에 전역 정렬해야
하므로 현재 페이지 데이터만 프론트에서 다시 정렬하는 방식은 사용할 수 없다.

## 결정 (Decision)

DB 전체 기본 콜레이션은 유지하고, 프로젝트 소유의 deterministic ICU 콜레이션 `core.ko_kr`
(`locale='ko-KR'`)을 만들어 `core.curriculum.title` 컬럼에만 적용한다. 공개 카탈로그와 강사 운영
목록의 이름순은 이 컬럼 규칙을 공유한다.

동명 커리큘럼에서도 페이지 순서를 고정하도록 정렬은 `title ASC, id ASC`로 확정한다. 공개 상태를
먼저 좁히는 조회를 위해 `(lifecycle_status, title, id)` 인덱스를 둔다.

## 근거 (Rationale)

- `ko-KR` ICU는 한글끼리는 가나다순, 영문끼리는 알파벳순으로 비교하며 영문 제목 저장을 막지 않는다.
- 컬럼 단위 적용이라 이메일·파일명·기술 식별자 등 다른 문자열 비교에는 영향을 주지 않는다.
- 같은 제목 컬럼을 읽는 모든 서버 페이지에서 Mock과 동일한 언어 규칙을 사용한다.
- id 2차 키가 서버 페이지네이션에 필요한 안정적인 전순서를 만든다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| `curriculum.title`에 ko-KR 적용(채택) | 영향 범위가 명확하고 모든 제목 정렬이 일관됨 | PostgreSQL ICU 지원이 필요함 |
| DB 전체 기본 locale을 ko-KR로 생성 | 쿼리마다 설정할 필요 없음 | 기존 DB 재생성과 다른 모든 문자열 정렬 변경이 필요함 |
| 조회 쿼리마다 `COLLATE` 명시 | 컬럼 정의를 바꾸지 않음 | 동적 Sort와 결합이 어렵고 새 조회에서 빠뜨리기 쉬움 |
| 프론트에서 현재 페이지 재정렬 | 구현이 간단해 보임 | 서버 페이지네이션의 전체 순서가 깨지고 페이지 간 누락·중복을 숨김 |

## 영향·후속 (Consequences)

- Flyway V36이 `core.ko_kr`를 만들고 `core.curriculum.title`과 제목순 인덱스를 갱신한다.
- 배포 PostgreSQL은 ICU를 제공해야 한다. 표준 이미지 `pgvector/pgvector:pg16`에서 이를 검증한다.
- 공개 카탈로그 계약 테스트가 한글 가나다순과 영문 알파벳순을 함께 검증한다.
- 테스트 채택 근거: 정렬은 서버 페이지네이션 경계를 넘는 사용자 관찰 계약이며, Mock과 실제 DB의
  차이로 이미 회귀가 발생했으므로 실제 PostgreSQL 계약 테스트가 필요하다.
