module github.com/liveclass/bench/mock-push

go 1.22

// h2c(평문 HTTP/2)를 위해서만 있는 의존이다. Go의 net/http 서버는 TLS 없이는
// HTTP/2를 말하지 않는데, WebPushHttpClient가 HTTP/2를 선호하고 연결 8개에
// 스트림을 겹치는 전제로 만들어져 있어(WebPushHttpClient.java:82) 1.1로 떨어지면
// 동시성이 800에서 8로 깎인다.
require golang.org/x/net v0.28.0

require golang.org/x/text v0.17.0 // indirect
