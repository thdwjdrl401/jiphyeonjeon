# webmobile1-skeleton

실시간 그룹 화상 회의 서비스를 위한 **스켈레톤 프로젝트**입니다. 학습 목적으로 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다.

## 1. Tech Stack

| 구분 | 기술 | 버전 및 비고 |
| ---- | ---- | ---- |
| Frontend | React 18.3, TypeScript, Vite 5, React Router 6, Context API, Axios | Node.js 20.18.0 LTS, npm |
| Backend | Spring Boot 2.7.18, Spring Security, QueryDSL | Java 11 권장, Gradle 6.9.4 |
| Realtime | Kurento Media Server 6.18.0 | 수동 설치 필요 |
| Database | MySQL 8.0.39 | `liveclass_web_db` (수동 설치 필요) |
| Auth & API | JWT, REST, Swagger | `http://localhost:8080/swagger-ui/index.html` |

## 2. Prerequisites

- **Java 11 JDK** (`JAVA_HOME` 설정 필수 - JDK 17 이상이면 Gradle 빌드 실패)
- **MySQL 8.0.39** (수동 설치 필요)
- **Node.js 20.18.0 (LTS)** + npm
- **Kurento Media Server 6.18.0** (수동 설치 필요)
- **Windows/macOS/Linux** 모두 지원

## 3. 빠른 실행 흐름

> 📘 실행 방법·필요 확장(VSCode)·트러블슈팅 상세는 **[RUN.md](./RUN.md)** 참고.

### 루트에서 한 번에 실행 (권장)

```bash
# 최초 1회 의존성 설치
npm run install:all

# 개발 모드 (프론트 HMR + 백엔드 핫리로드 동시)
npm run dev        # FE http://localhost:8083 , BE http://localhost:8080

# 통합 구동 (프론트 빌드 후 백엔드 단일 포트)
npm start          # http://localhost:8080
```

VSCode에서는 `Extension Pack for Java` 설치 후 `GroupCallApplication.java`의 ▶ Run/Debug 버튼으로도 백엔드를 실행할 수 있습니다. (자세한 내용은 [RUN.md](./RUN.md))

### (참고) 구성요소별 개별 실행 순서 (로컬 개발 환경)

1. **MySQL 설치 및 DB 생성**
   - MySQL 8.0.39 설치
   - DB 생성: `create database IF NOT EXISTS liveclass_web_db collate utf8mb4_general_ci;`
   - 계정 생성 및 권한 부여

2. **백엔드 설정**
   ```bash
   cd backend
   # src/main/resources/application.properties 수정
   # spring.datasource.username=<사용자 계정>
   # spring.datasource.password=<비밀번호>
   # spring.datasource.url의 포트 번호 확인 (기본값: 3306)
   ```

3. **백엔드 빌드 & 실행**
   ```bash
   cd backend
   ./gradlew clean build
   ./gradlew bootRun
   ```
   - 기본 포트: **HTTP 8080** (Swagger: `http://localhost:8080/swagger-ui/index.html`)
   - **주의**: skeleton은 기본 설정만 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다.

4. **프론트엔드 개발 서버 실행**
   ```bash
   cd frontend
   npm install      # 최초 한 번만 실행 (의존성 설치)
   npm run dev      # http://localhost:8083
   ```

5. **접속 및 검증**
   - 프론트엔드: `http://localhost:8083` (개발 서버)
   - 백엔드 API: `http://localhost:8080`
   - Swagger UI: `http://localhost:8080/swagger-ui/index.html`

> **참고**: skeleton 프로젝트는 학습 목적으로 제공되며, 일부 기능은 학습자가 직접 구현해야 합니다. 완성된 코드는 `webmobile1-complete` 프로젝트를 참고하세요.

## 4. 디렉터리 구조

```
webmobile1-skeleton/
├── README.md                          # 전체 개요 및 실행 요약 (현재 문서)
├── backend/                           # Spring Boot 프로젝트
│   └── src/main/...                   # API, 도메인, 정적 리소스 포함
└── frontend/                          # React + TypeScript 프론트엔드
    └── src/...                        # React 컴포넌트, Context, 라우터 등
```

## 5. 주요 포트 및 서비스

| 서비스 | 포트 | 설명 |
| ---- | ---- | ---- |
| Spring Boot (HTTP) | 8080 | 백엔드 API 및 정적 리소스 (기본 접속 포트) |
| React 개발 서버 | 8083 | 프론트엔드 개발 서버 (`npm run dev`) |
| MySQL | 3306 | 로컬 MySQL 서버 |
| Kurento Media Server | 8888 | WebRTC 미디어 서버 (수동 설치 필요) |

## 6. Troubleshooting

- **Gradle 빌드 오류**: `JAVA_HOME`이 JDK 11을 가리키는지 확인 (`java -version`)
- **포트 충돌**: 8080, 8083, 3306, 8888 포트 사용 여부 확인
- **DB 연결 실패**: 
  - MySQL 서버가 실행 중인지 확인
  - `application.properties`의 DB 연결 정보 확인 (username, password, url의 포트 번호)
  - MySQL 계정 권한 확인
