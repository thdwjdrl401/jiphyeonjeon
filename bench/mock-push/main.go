// 목 푸시 서버 — Web Push 발송 대역.
//
// **왜 필요한가.** 실제 FCM에 120만 건을 보낼 수 없다(정책 상한 분당 1,000). 그렇다고
// 발송을 빼고 재면 HTTP·커넥션 비용이 통째로 빠져 암호화 CPU만 재게 된다.
//
// **지켜야 할 것 둘.**
//
//  1. h2c를 말한다. WebPushHttpClient가 HTTP/2를 선호하고 연결 8개에 스트림을 겹치는데
//     (WebPushHttpClient.java:82), 상대가 1.1로 떨어지면 연결 하나가 요청 하나씩만
//     처리해 동시성이 8로 깎인다. 지연 50ms면 초당 160건 — 우리 시스템이 아니라 목
//     서버를 재는 셈이 된다. Go의 net/http는 평문 HTTP/2를 기본으로 말하지 않으므로
//     h2c 래퍼를 명시적으로 씌운다.
//
//  2. 자기가 병목이 되지 않는다. 요청당 하는 일은 본문 버리기 + 지연 + 응답뿐이고,
//     /stats가 동시 처리 수와 처리율을 노출해 병목 여부를 실행마다 확인할 수 있다.
//
// 지연·에러율은 **주입 파라미터**다. 예전 측정의 "목 FCM 지연 230ms"는 그렇게 나온
// 값이지 정한 값이 아니었다. 통제하려면 정해야 한다.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

type counters struct {
	total     atomic.Int64
	delivered atomic.Int64 // 2xx
	tooMany   atomic.Int64 // 429
	serverErr atomic.Int64 // 5xx
	gone      atomic.Int64 // 410
	bytesIn   atomic.Int64

	firstAtUnixMs atomic.Int64
	lastAtUnixMs  atomic.Int64

	inFlight    atomic.Int64
	maxInFlight atomic.Int64
}

func (c *counters) enter() {
	now := time.Now().UnixMilli()
	// 첫 요청 시각은 한 번만 찍는다. 처리율의 분모가 되는 값이라 나중 요청이 덮으면 안 된다.
	c.firstAtUnixMs.CompareAndSwap(0, now)
	c.lastAtUnixMs.Store(now)

	n := c.inFlight.Add(1)
	for {
		max := c.maxInFlight.Load()
		if n <= max || c.maxInFlight.CompareAndSwap(max, n) {
			break
		}
	}
}

func (c *counters) leave() { c.inFlight.Add(-1) }

func (c *counters) reset() {
	c.total.Store(0)
	c.delivered.Store(0)
	c.tooMany.Store(0)
	c.serverErr.Store(0)
	c.gone.Store(0)
	c.bytesIn.Store(0)
	c.firstAtUnixMs.Store(0)
	c.lastAtUnixMs.Store(0)
	c.maxInFlight.Store(0)
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	delay := flag.Duration("delay", 50*time.Millisecond, "응답 전 고정 지연")
	jitter := flag.Duration("jitter", 10*time.Millisecond, "지연에 더할 난수 폭 (0~jitter)")
	rate429 := flag.Float64("rate-429", 0, "429 응답 비율 0~1")
	rate5xx := flag.Float64("rate-5xx", 0, "500 응답 비율 0~1")
	rate410 := flag.Float64("rate-410", 0, "410 응답 비율 0~1 (죽은 구독)")
	retryAfter := flag.Int("retry-after", 2, "429에 실을 Retry-After 초")
	flag.Parse()

	c := &counters{}
	started := time.Now()

	mux := http.NewServeMux()

	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		first, last := c.firstAtUnixMs.Load(), c.lastAtUnixMs.Load()
		elapsed := 0.0
		if first > 0 && last > first {
			elapsed = float64(last-first) / 1000
		}
		total := c.total.Load()
		perSecond := 0.0
		if elapsed > 0 {
			perSecond = float64(total) / elapsed
		}
		writeJSON(w, map[string]any{
			"total":          total,
			"delivered":      c.delivered.Load(),
			"tooMany":        c.tooMany.Load(),
			"serverError":    c.serverErr.Load(),
			"gone":           c.gone.Load(),
			"bytesIn":        c.bytesIn.Load(),
			"firstAtUnixMs":  first,
			"lastAtUnixMs":   last,
			"elapsedSeconds": round(elapsed, 3),
			"ratePerSecond":  round(perSecond, 1),
			"inFlight":       c.inFlight.Load(),
			"maxInFlight":    c.maxInFlight.Load(),
			"uptimeSeconds":  round(time.Since(started).Seconds(), 1),
			"config": map[string]any{
				"delayMs":  delay.Milliseconds(),
				"jitterMs": jitter.Milliseconds(),
				"rate429":  *rate429,
				"rate5xx":  *rate5xx,
				"rate410":  *rate410,
			},
		})
	})

	mux.HandleFunc("/reset", func(w http.ResponseWriter, r *http.Request) {
		c.reset()
		started = time.Now()
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// 나머지 전부가 푸시 엔드포인트다. 시드가 endpoint를 http://mock-push:8080/fcm/<uuid>로
	// 넣으므로 경로를 따지지 않는다.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		c.enter()
		defer c.leave()

		// 본문을 반드시 다 읽어 버린다. 안 읽으면 커넥션 재사용이 깨져 클라이언트가
		// 매번 새 연결을 열게 되고, 그 비용이 우리 측정에 섞인다.
		n, _ := io.Copy(io.Discard, r.Body)
		c.bytesIn.Add(n)
		c.total.Add(1)

		if d := *delay; d > 0 || *jitter > 0 {
			extra := time.Duration(0)
			if *jitter > 0 {
				extra = time.Duration(rand.Int64N(int64(*jitter)))
			}
			time.Sleep(d + extra)
		}

		// 분포는 누적 임계로 가른다. rand/v2는 고루틴마다 독립이라 잠금 경합이 없다.
		roll := rand.Float64()
		switch {
		case roll < *rate410:
			c.gone.Add(1)
			w.WriteHeader(http.StatusGone)
		case roll < *rate410+*rate429:
			c.tooMany.Add(1)
			w.Header().Set("Retry-After", strconv.Itoa(*retryAfter))
			w.WriteHeader(http.StatusTooManyRequests)
		case roll < *rate410+*rate429+*rate5xx:
			c.serverErr.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			c.delivered.Add(1)
			// FCM은 성공에 201을 준다. 우리 클라이언트의 verdictOf는 2xx 전체를
			// DELIVERED로 보므로 값 자체가 중요하진 않지만, 실제와 맞춘다.
			w.WriteHeader(http.StatusCreated)
		}
	})

	h2s := &http2.Server{
		// 연결당 동시 스트림. 실제 FCM·Mozilla가 광고하는 값과 맞춘다
		// (application.yml의 streams-per-connection과 짝이다).
		MaxConcurrentStreams: 100,
	}
	server := &http.Server{
		Addr:    *addr,
		Handler: h2c.NewHandler(mux, h2s),
		// 지연을 주입하므로 읽기·쓰기 타임아웃을 넉넉히 둔다. 짧으면 목 서버가
		// 끊어 버려서 클라이언트가 그것을 발송 실패로 세게 된다.
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("목 푸시 서버 %s · 지연 %v(+지터 %v) · 429 %.3f · 5xx %.3f · 410 %.3f",
		*addr, *delay, *jitter, *rate429, *rate5xx, *rate410)
	log.Fatal(server.ListenAndServe())
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", " ")
	_ = enc.Encode(v)
}

func round(v float64, places int) float64 {
	f, _ := strconv.ParseFloat(fmt.Sprintf("%.*f", places, v), 64)
	return f
}
