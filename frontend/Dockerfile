# 프론트(React+Vite) 빌드 → nginx 정적 서빙 + 리버스 프록시
# build context = ./frontend (docker-compose.prod.yml의 frontend.build)
# syntax=docker/dockerfile:1

# ---- build stage : Vite 프로덕션 빌드 ----
FROM node:20-alpine AS build
WORKDIR /app

# lockfile 기반 재현 설치
COPY package.json package-lock.json ./
RUN npm ci

# 소스 → dist (실 API 사용: mock 강제 off)
COPY . .
RUN VITE_USE_MOCK_API=false npm run build

# ---- runtime stage : nginx (SSL 종단 + SPA + /api 프록시) ----
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
