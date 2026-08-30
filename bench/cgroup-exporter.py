#!/usr/bin/env python3
"""컨테이너 cgroup 메모리를 Prometheus 지표로 내보낸다. 표준 라이브러리만 쓴다.

**왜 필요한가.** cAdvisor 가 이 커널(5.15)에서 못 주는 값이 있다.

  container_memory_max_usage_bytes   0 으로 비어 있음 (cgroup v2 에서 안 채움)
  container_memory_failcnt           0 으로 비어 있음
  memory.events 의 max·oom_kill      아예 안 내보냄

그리고 급등이 표본 사이로 빠진다. 실측에서 익명 메모리가 731MB 로 튄 구간은 0.5초 표본
40개 중 딱 하나였다. cAdvisor 는 1초 하우스키핑에 Prometheus 스크레이프가 1초라 그 한 점을
놓친다. 놓치면 곡선이 한계선 근처에도 안 가고, 그림이 캡션을 반박한다.

**두 가지로 푼다.**

  커널 카운터   memory.events 의 max(한계에 부딪힌 횟수)와 oom_kill 은 누적값이라 표본
                간격과 무관하다. 놓칠 수가 없다. 커널 5.19 부터 있는 memory.peak 이
                없는 커널에서 최고 수위를 대신한다.
  촘촘한 표본   memory.current 와 memory.stat 을 50ms 마다 읽어 최고 수위를 들고 있는다.
                0.5초짜리 급등을 놓치지 않는다. 스크레이프는 그 값을 가져가기만 한다.

읽는 것은 커널이 쓴 파일뿐이다. 계산하는 것은 최고 수위 하나이고, 그것도 읽은 값 중
가장 큰 것을 고르는 것이다.

사용법
  python3 bench/cgroup-exporter.py --port 18083 --container liveclass-bench-postgres-1
"""
import argparse
import http.client
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CGROOT = os.environ.get("CGROOT", "/sys/fs/cgroup")
DOCKER_SOCK = os.environ.get("DOCKER_SOCK", "/var/run/docker.sock")


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost")
        self._path = path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(4)
        s.connect(self._path)
        self.sock = s


def container_id(name):
    c = UnixHTTP(DOCKER_SOCK)
    try:
        c.request("GET", f"/containers/{name}/json")
        r = c.getresponse()
        if r.status != 200:
            return None
        return json.loads(r.read()).get("Id")
    except OSError:
        return None
    finally:
        c.close()


def list_containers(prefix):
    """이름이 prefix로 시작하는 컨테이너의 {이름: id}. 죽은 것은 빼고."""
    c = UnixHTTP(DOCKER_SOCK)
    out = {}
    try:
        c.request("GET", "/containers/json")
        r = c.getresponse()
        if r.status != 200:
            return out
        for item in json.loads(r.read()):
            for name in item.get("Names") or []:
                name = name.lstrip("/")
                if name.startswith(prefix):
                    out[name] = item.get("Id")
    except OSError:
        pass
    finally:
        c.close()
    return out


def cpus_effective(cgdir):
    """cpuset.cpus.effective 가 몇 개인가. "0-1,4" 같은 표기를 센다.

    **cAdvisor 로는 못 구한다.** container_spec_cpu_quota 는 compose 의 cpus 값(8코어)을
    말하고, 실제로 쓸 수 있는 것은 cpuset 이 정한 코어다. 그 둘이 다르면 "몇 %까지 갈 수
    있는가"를 알 수 없고, 그러면 컨테이너끼리 CPU 를 나란히 놓고 못 읽는다.
    """
    try:
        with open(os.path.join(cgdir, "cpuset.cpus.effective")) as f:
            spec = f.read().strip()
    except OSError:
        return None
    if not spec:
        return None
    n = 0
    for part in spec.split(","):
        if "-" in part:
            a, _, b = part.partition("-")
            n += int(b) - int(a) + 1
        else:
            n += 1
    return n


def cgroup_dir(cid):
    for p in (f"{CGROOT}/system.slice/docker-{cid}.scope",
              f"{CGROOT}/docker/{cid}",
              f"{CGROOT}/memory/docker/{cid}"):
        if os.path.isfile(os.path.join(p, "memory.current")):
            return p
    return None


def read_int(path):
    try:
        with open(path) as f:
            v = f.read().strip()
        return int(v) if v.isdigit() else None
    except OSError:
        return None


def read_kv(path):
    out = {}
    try:
        with open(path) as f:
            for line in f:
                k, _, v = line.partition(" ")
                if v.strip().isdigit():
                    out[k] = int(v)
    except OSError:
        pass
    return out


class Sampler(threading.Thread):
    """50ms 마다 훑어 최고 수위를 든다. 급등이 표본 사이로 빠지지 않게."""

    daemon = True

    def __init__(self, name, interval):
        super().__init__()
        self.name_ = name
        self.interval = interval
        self.lock = threading.Lock()
        self.state = {}
        self.peak_current = 0
        self.peak_anon = 0
        self.cid = None
        self.dir = None
        self.cpus = {}

    def resolve(self):
        cid = container_id(self.name_)
        if cid and cid != self.cid:
            d = cgroup_dir(cid)
            if d:
                # 컨테이너가 바뀌면 최고 수위도 새로 센다. 앞 컨테이너의 값이 남으면
                # 다음 회차가 시작부터 최고점을 물고 있는 것처럼 보인다.
                self.cid, self.dir = cid, d
                self.peak_current = self.peak_anon = 0

    def scan_cpus(self):
        """벤치 컨테이너 전부의 배정 코어 수. 회차마다 cpuset 이 바뀌므로 계속 다시 읽는다."""
        found = {}
        for name, cid in list_containers("liveclass-bench-").items():
            d = cgroup_dir(cid)
            if not d:
                continue
            n = cpus_effective(d)
            if n:
                found[name] = n
        with self.lock:
            self.cpus = found

    def run(self):
        last_resolve = 0.0
        while True:
            now = time.time()
            if now - last_resolve > 2 or not self.dir:
                self.resolve()
                self.scan_cpus()
                last_resolve = now
            if self.dir:
                cur = read_int(os.path.join(self.dir, "memory.current"))
                st = read_kv(os.path.join(self.dir, "memory.stat"))
                ev = read_kv(os.path.join(self.dir, "memory.events"))
                lim = read_int(os.path.join(self.dir, "memory.max"))
                anon = st.get("anon")
                with self.lock:
                    if cur is not None:
                        self.peak_current = max(self.peak_current, cur)
                    if anon is not None:
                        self.peak_anon = max(self.peak_anon, anon)
                    self.state = {
                        "current": cur, "anon": anon,
                        "file": st.get("file"), "shmem": st.get("shmem"),
                        "limit": lim, "events": ev,
                    }
            time.sleep(self.interval)

    def reset_peak(self):
        with self.lock:
            cur = (self.state or {}).get("current") or 0
            anon = (self.state or {}).get("anon") or 0
            self.peak_current, self.peak_anon = cur, anon

    def render(self):
        with self.lock:
            s = dict(self.state)
            pc, pa = self.peak_current, self.peak_anon
            cpus = dict(self.cpus)
        head = [
            "# HELP bench_cgroup_cpus_effective cpuset.cpus.effective 의 코어 수 (CPU 상한 = 이 값 × 100%)",
            "# TYPE bench_cgroup_cpus_effective gauge",
        ]
        head += ['bench_cgroup_cpus_effective{name="%s"} %d' % (n, v) for n, v in sorted(cpus.items())]
        prefix = "\n".join(head) + "\n"
        if not s:
            return prefix + "# 메모리 cgroup 을 아직 못 찾았다\n"
        lb = 'container="%s"' % self.name_
        out = [
            "# HELP bench_cgroup_memory_current_bytes cgroup memory.current",
            "# TYPE bench_cgroup_memory_current_bytes gauge",
            "# HELP bench_cgroup_memory_peak_bytes 50ms 표본에서 본 memory.current 최고 수위",
            "# TYPE bench_cgroup_memory_peak_bytes gauge",
            "# HELP bench_cgroup_memory_events_total memory.events 누적 카운터",
            "# TYPE bench_cgroup_memory_events_total counter",
        ]
        for k, v in (("current", s.get("current")), ("anon", s.get("anon")),
                     ("file", s.get("file")), ("shmem", s.get("shmem")),
                     ("limit", s.get("limit"))):
            if v is not None:
                out.append("bench_cgroup_memory_%s_bytes{%s} %d" % (k, lb, v))
        out.append("bench_cgroup_memory_peak_bytes{%s} %d" % (lb, pc))
        out.append("bench_cgroup_memory_anon_peak_bytes{%s} %d" % (lb, pa))
        for k, v in (s.get("events") or {}).items():
            out.append('bench_cgroup_memory_events_total{%s,event="%s"} %d' % (lb, k, v))
        return prefix + "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18083)
    ap.add_argument("--container", default="liveclass-bench-postgres-1")
    ap.add_argument("--interval", type=float, default=0.05)
    a = ap.parse_args()

    sampler = Sampler(a.container, a.interval)
    sampler.start()

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            # 회차 시작에 부른다. 최고 수위가 누적이면 앞 회차 값을 물고 시작해
            # 그래프가 회차별 최고점이 아니라 지금까지의 최고점을 그린다.
            if self.path.rstrip("/") == "/reset":
                sampler.reset_peak()
                self.send_response(204); self.end_headers()
            else:
                self.send_response(404); self.end_headers()

        def do_GET(self):
            body = sampler.render().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    ThreadingHTTPServer(("0.0.0.0", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
