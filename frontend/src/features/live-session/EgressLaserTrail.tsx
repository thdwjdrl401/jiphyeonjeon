import { useEffect, useRef } from 'react'
import { LaserPointer } from '@excalidraw/laser-pointer'
import { RoomEvent, type Room } from 'livekit-client'
import {
  ANNOTATION_FRAME_HEIGHT,
  ANNOTATION_FRAME_WIDTH,
  ANNOTATION_LASER_TOPIC,
  LASER_COLOR,
  decodeLaserStroke,
  laserOutlinePath,
  laserTrailOptions,
} from './annotation'

/**
 * Egress 합성 화면의 레이저 잔상(ADR-0051).
 *
 * <p><b>왜 판서와 따로인가.</b> 레이저는 Excalidraw에서 scene 요소가 아니다 — 사라지는 궤적이라
 * `onChange`에 잡히지 않고 `exportToCanvas`(요소만 그림)에도 없다. 그래서 강사 쪽이 포인터 좌표를
 * 직접 주워 별도 topic으로 보내고, 여기서 우리가 그린다.
 *
 * <p><b>Excalidraw와 같은 라이브러리·같은 옵션을 쓴다.</b> 강사 화면은 Excalidraw의
 * `AnimatedTrail`이 그리고 수강생 화면은 이 컴포넌트가 그리므로, 구현이 다르면 두 화면이 달라진다
 * ("강사가 보는 화면 = 수강생이 보는 화면"). 그래서 모양을 흉내내지 않고 `@excalidraw/laser-pointer`의
 * `LaserPointer`로 <b>같은 외곽선</b>을 만들어 같은 색으로 채운다 — Excalidraw도 정확히 그렇게 한다
 * (`getStrokeOutline()` → svg path → `fill: DEFAULT_LASER_COLOR`).
 *
 * <p>시각(`pressure` 자리)은 <b>강사 시계</b>로 찍힌 값이다. 감쇠를 우리 시계로 계산하면 두 브라우저의
 * 시계 차이만큼 잔상 길이가 어긋나므로, 받은 점의 시각을 그대로 쓰되 기준시각도 강사 축으로 옮긴다.
 */
export default function EgressLaserTrail({ room }: { room: Room | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /** 진행 중인 획과 사라지는 중인 획들. state가 아니라 ref다 — 초당 수십 번 도는 값이다. */
  const currentRef = useRef<LaserPointer | null>(null)
  const pastRef = useRef<LaserPointer[]>([])
  /** 강사 시계 기준 "지금". 마지막으로 받은 점의 시각으로 갱신한다. */
  const nowRef = useRef(0)
  /** 마지막으로 받은 획의 강사 zoom. 굵기 보정에 쓴다. */
  const zoomRef = useRef(1)

  useEffect(() => {
    if (!room) return undefined

    const options = laserTrailOptions(() => nowRef.current)

    const onData = (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
      if (topic !== ANNOTATION_LASER_TOPIC) return
      const stroke = decodeLaserStroke(payload)
      if (!stroke) return

      if (stroke.phase === 'start') {
        // 진행 중이던 획이 있으면(pointerup 유실) 흘려보낸다. 남겨 두면 새 획과 이어져 보인다.
        if (currentRef.current) pastRef.current.push(currentRef.current)
        currentRef.current = new LaserPointer(options)
      }
      const trail = currentRef.current
      if (!trail) return

      zoomRef.current = stroke.zoom
      for (const point of stroke.points) {
        nowRef.current = Math.max(nowRef.current, point.t)
        trail.addPoint([point.x, point.y, point.t])
      }

      if (stroke.phase === 'end') {
        trail.close()
        trail.options.keepHead = false
        pastRef.current.push(trail)
        currentRef.current = null
      }
    }

    room.on(RoomEvent.DataReceived, onData)
    return () => { room.off(RoomEvent.DataReceived, onData) }
  }, [room])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const context = canvas.getContext('2d')
    if (!context) return undefined

    let frame = 0
    let painted = false

    const draw = () => {
      frame = requestAnimationFrame(draw)

      // 잔상은 시간이 지나면 옅어져야 하므로, 새 점이 없어도 시계를 흘려보낸다. 다만 강사 축과
      // 어긋나지 않게 프레임 간격만큼만 더한다.
      if (nowRef.current > 0) nowRef.current += 1000 / 60

      // 외곽선이 비면 다 사라진 획이다.
      pastRef.current = pastRef.current.filter((trail) => trail.getStrokeOutline().length !== 0)
      const trails = currentRef.current ? [...pastRef.current, currentRef.current] : pastRef.current

      if (trails.length === 0) {
        if (painted) {
          context.clearRect(0, 0, canvas.width, canvas.height)
          painted = false
          nowRef.current = 0
        }
        return
      }

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = LASER_COLOR
      for (const trail of trails) {
        // Excalidraw와 같은 보정: 외곽선을 `size / zoom`으로 만든다. 빼면 강사 창이 작을수록
        // 수강생 화면의 궤적이 가늘어진다(강사는 늘 2px, 우리는 2×zoom px).
        const outline = trail.getStrokeOutline(trail.options.size / zoomRef.current)
        // Excalidraw와 같은 곡선 path로 채운다. 직선으로 이으면 획이 조금 더 두껍고 끝이 더 뻗어,
        // 레이저가 강사가 가리킨 곳에서 살짝 밀린 것처럼 보인다(laserOutlinePath).
        const path = laserOutlinePath(outline)
        if (path === '') continue
        context.fill(new Path2D(path))
      }
      painted = true
    }

    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame) }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="egress-stage__laser"
      /*
       * 캔버스 픽셀을 논리 프레임과 1:1로 잡는다. 받은 좌표를 변환 없이 그대로 그릴 수 있고,
       * 화면 크기는 CSS가 맞춘다 — 판서 배치와 같은 규칙이다.
       */
      height={ANNOTATION_FRAME_HEIGHT}
      width={ANNOTATION_FRAME_WIDTH}
    />
  )
}
