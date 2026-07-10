# 실행 가이드 (RUN)

루트 디렉토리에서 프론트엔드 + 백엔드를 한 번에 실행하기 위한 가이드입니다.
(전체 프로젝트 개요는 [README.md](./README.md) 참고)

## 1. 필요 의존성

| 구분 | 요구사항 | 비고 |
| ---- | ---- | ---- |
| **JDK** | Java **11** | `JAVA_HOME`이 JDK 11을 가리켜야 함. **JDK 17+ 는 Gradle 6.9.4 빌드 실패** |
| **Node.js** | 20.18.0 (LTS) + npm | 프론트엔드(Vite) 빌드/실행 |
| **MySQL** | 8.0.x | DB `liveclass_web_db` 필요 (아래 참고) |
| **Kurento** | 6.18.0 (선택) | WebRTC 화상 기능 사용 시에만. 없어도 앱 기동은 정상 |
| **VSCode 확장** | `Extension Pack for Java` | Java 파일 ▶ Run/Debug 버튼 제공 |
| (선택) | `Vue - Official (Volar)` | 프론트엔드 개발 편의 |

> VSCode로 열면 위 확장들이 **추천 팝업**으로 안내됩니다 (`.vscode/extensions.json`).

### DB 최초 생성 (1회)
```sql
CREATE DATABASE IF NOT EXISTS liveclass_web_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
```
접속 정보는 `backend/src/main/resources/application.properties`의 `spring.datasource.username / password / url`에서 확인·수정하세요 (기본 `root / 1234 / 3306`).

## 2. 최초 1회 설치

```bash
# 루트에서
npm run install:all
# (= npm install  +  npm --prefix frontend install)
```

## 3. 실행 방법

### 방법 A. 터미널 (루트에서 한 번에)

| 환경 | 개발 모드 | 통합 구동 | 전체 빌드 |
| ---- | ---- | ---- | ---- |
| Windows (기본) | `npm run dev` | `npm start` | `npm run build` |
| WSL | `npm run dev:wsl` | `npm run start:wsl` | `npm run build:wsl` |

WSL에서 `Permission denied: ./gradlew`이 발생할 때만 `chmod +x backend/gradlew`을 실행합니다. MySQL이 꺼져 있으면 `sudo service mysql start`로 시작합니다.

### 방법 B. VSCode 실행 버튼

1. `Extension Pack for Java` 확장을 설치합니다(추천 팝업 또는 마켓플레이스).
2. `backend/src/main/java/com/liveclass/GroupCallApplication.java` 파일을 엽니다.
3. `main()` 위의 **Run ▶ | Debug** 또는 편집기 우측 상단 ▶ 버튼을 클릭 → 백엔드가 **8080**에서 실행됩니다.
   - 빌드된 프론트(`backend/src/main/resources/dist/`)를 그대로 서빙합니다.
   - 프론트 최신 변경을 반영하려면 `npm run build:fe`를 1회 실행하거나, 프론트 개발 시엔 방법 A의 `npm run dev`를 병행하세요.
4. 프론트 + 백엔드를 VSCode에서 동시에 띄우려면 **실행 및 디버그** 패널에서 `Full Stack (BE + FE)` 구성을 선택해 실행합니다(`.vscode/launch.json`).

> VSCode의 Java 런타임은 **JDK 11**이어야 합니다(JDK 17+면 Gradle 빌드 실패). VSCode 경로에서는 Java 확장이 저장 시 자동 컴파일하므로 별도 watch가 필요 없습니다.

## 4. 포트 및 서비스

| 서비스 | 포트 | 설명 |
| ---- | ---- | ---- |
| Spring Boot (HTTP) | 8080 | 백엔드 API + 정적 리소스(통합 구동 시 접속 포트) |
| Vue 개발 서버 | 8083 | 프론트엔드 dev 서버(`npm run dev`/`npm run dev:wsl`, `/api/v1` 등을 8080으로 프록시) |
| MySQL | 3306 | 로컬 DB |
| Kurento Media Server | 8888 | WebRTC 미디어 서버(선택) |

## 5. dev vs 통합 구동 차이

| | `npm run dev` | `npm start` |
| ---- | ---- | ---- |
| 프론트 | Vite dev 서버(8083), **HMR 즉시 반영** | 빌드 후 백엔드가 서빙(8080) |
| 백엔드 | `bootRun` + DevTools 핫리로드 | `bootRun` |
| 접속 | 8083(프론트) / 8080(API) | 8080 하나 |
| 용도 | **개발**(프론트/백 수정) | **구동/데모**(단일 포트) |

## 6. 트러블슈팅

- **Gradle 빌드 오류**: `java -version` / `JAVA_HOME`이 JDK 11인지 확인. JDK 17+면 실패.
- **`JAVA_HOME`이 안 잡힘**: 환경변수를 설정한 뒤에는 **터미널/VSCode를 새로 열어야** 반영됩니다(기존 프로세스는 이전 값 유지).
- **포트 충돌**: 8080 / 8083 / 3306 / 8888 사용 여부 확인.
- **DB 연결 실패**: MySQL 실행 여부, `liveclass_web_db` 존재 여부, `application.properties`의 접속 정보 확인.
- **WSL에서 Windows npm(`/mnt/c/...`)이 잡힘**: `which node`와 `which npm`을 확인하고 WSL 내부에 Node.js 20.18.0을 설치한 뒤 터미널을 다시 연다.
- **로그 위치**: 백엔드 로그는 `backend/logs/`에 쌓입니다(git 무시 대상).
- **`bootRun` + watch 파일락(Windows, 드묾)**: `npm run dev` 중 간헐적 락 발생 시, VSCode의 Java ▶ 실행(방법 B)을 쓰면 watch 없이 저장 시 컴파일로 핫리로드됩니다.
