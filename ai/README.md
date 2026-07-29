# AI services

Python 3.12와 `uv`를 사용하는 LiveClass AI 서비스 모음이다. 각 서비스는 의존성과
lockfile을 독립적으로 관리한다.

| 서비스 | 역할 | 기본 관리 주소 |
|---|---|---|
| [`ai-api`](ai-api/README.md) | Redis/pgvector/BGE 근거와 GMS 답변을 조율하는 RAG SSE 서비스 | `127.0.0.1:8010` |
| [`ai-worker`](ai-worker/README.md) | 비동기 AI 작업 프로세스 골격 | `127.0.0.1:8011` |
| [`realtime-agent`](realtime-agent/README.md) | LiveKit 강사 오디오→provider-neutral STT→Redis caption agent | LiveKit AgentServer |
| [`bge-runtime`](bge-runtime/README.md) | 인증된 BGE-M3 내부 GPU embedding runtime | `127.0.0.1:8020` |

현재 범위는 ai-api의 RAG 요청→Redis/pgvector/BGE 근거 조회→GMS 답변→SSE terminal
AI-side runtime, ai-worker의 RabbitMQ PPTX ingestion→BGE→pgvector→Spring callback 실행 경로,
realtime-agent의 runnable AgentServer·오디오·VAD·STT·제한된 Redis caption 발행, 독립 BGE-M3
runtime까지다. Spring의 `ingestion.embed` 큐 선기동도 연결됐다.

Java가 아직 채택하지 않은 Python 경계는 각 서비스의 후보 계약으로 관리하며 공유
`docs/CONTRACT.md`를 확정 변경하지 않는다. ai-api의 context consumer·GMS client·단일 process
request registry는 조립했고, Spring→ai-api 내부 인증은 HMAC 공유 시크릿 방식(ADR-0023 §9)으로
채택 확정돼 ai-api 쪽 검증기(`HmacInternalRequestAuthenticator`)까지 구현·테스트 완료했다.
`AI_INTERNAL_SECRET` 미설정 시 production RAG endpoint는 여전히 `503`으로 fail-closed하며,
Spring 쪽 서명 발급기가 아직 없어 실제 상호 인증까지는 안 된다. Spring 발급기·SSE proxy·양쪽
계약 테스트, Java live caption dispatch/consumer, multi-replica registry와 실제 GMS·Spring E2E는
후속 협업 gate다.

실행과 검증 명령은 각 서비스 README를 따른다. ai-api·realtime-agent를 로컬에서 같이 띄울 때 쓰는
환경변수는 [`env.example`](env.example)에 모아뒀다 — `ai/.env`로 복사해 채운다(git 무시).

## realtime-agent 통신 요약

realtime-agent는 Spring이 직접 호출하는 HTTP 서비스가 아니다. Spring이 LiveKit에 explicit dispatch를
만들면, LiveKit에 등록된 Python Worker가 job을 받아 Room 오디오를 처리한다. 자막은 application
Redis Stream으로 보내고, lifecycle callback은 Java 수신 구현이 준비된 경우에만 선택적으로 사용한다.

```text
Spring ──dispatch──> LiveKit ──job/WebRTC audio──> realtime-agent
                                                   ├─ local GPU: Nemotron
                                                   ├─ outbound WSS: OpenAI Realtime
                                                   ├─ Redis: lease + caption stream
                                                   └─ HTTP(S): Spring callback (기본 비활성)
```

세부 protocol, 소유권과 장애 처리는
[`realtime-agent/README.md`](realtime-agent/README.md#통신-구조)와
[`realtime-agent/CONTRACT.md`](realtime-agent/CONTRACT.md)를 따른다.

## 폴더별 문서

각 서비스 README에서 실행 코드와 테스트 폴더의 상세 README로 이어진다. `.venv*`, `.uv-cache*`,
`.pytest*`, `__pycache__`, `models/`는 로컬 생성 자산이므로 대상에서 제외한다.
