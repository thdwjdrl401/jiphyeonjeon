# 목 푸시 서버.
#
# 다단계 빌드다 — 최종 이미지에 Go 툴체인을 남기지 않는다. 이 컨테이너는 벤치에서
# 코어를 따로 배정받아 돌고, 자기가 병목이 되면 안 되므로 가볍게 유지한다.
FROM golang:1.22-alpine AS build
WORKDIR /src
# go.sum을 커밋해 둔다. 해시가 고정돼야 빌드가 재현된다.
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
# CGO를 끄고 정적 링크한다. alpine 런타임에 libc 의존을 남기지 않는다.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mock-push .

FROM alpine:3.20
RUN adduser -D -u 10001 mock
USER mock
COPY --from=build /out/mock-push /usr/local/bin/mock-push
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/mock-push"]
