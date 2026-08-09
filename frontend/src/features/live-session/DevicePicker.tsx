import type { InstructorLiveMedia } from './useInstructorLiveKit'

interface DevicePickerProps {
  publisher: InstructorLiveMedia
  kind: MediaDeviceKind
  label: string
  /** 고를 것이 없을 때 대신 보여 줄 말. 장치가 정말 없는 경우와 아직 못 읽은 경우를 함께 덮는다. */
  emptyHint: string
}

/**
 * 브라우저가 라벨을 안 줄 때 쓸 이름.
 *
 * <p>권한을 받기 전에는 `label`이 빈 문자열이라 목록이 빈칸만 늘어선다. 순번이라도 붙여야 "두 개가
 * 잡혀 있다"는 사실은 전해진다. 준비 화면은 이미 카메라·마이크를 연 뒤라 대개 실제 이름이 온다.
 */
function deviceLabel(device: MediaDeviceInfo, index: number) {
  if (device.label) return device.label
  return `장치 ${index + 1}`
}

/**
 * 입력·출력 장치를 고른다.
 *
 * <p>이게 없으면 <b>무엇이 잡혔는지조차 알 수 없다.</b> 노트북 내장 마이크로 한 시간을 녹음하고
 * 나서야 알게 되는 종류의 실패라, 적어도 시작 전에는 보이고 바꿀 수 있어야 한다.
 *
 * <p>바꾸면 트랙이 잠깐 끊긴다. LiveKit이 기존 트랙의 소스만 갈아끼우므로 재발행은 아니다 —
 * 트랙의 `source`가 유지돼 STT가 강사 발화를 계속 알아본다.
 */
export default function DevicePicker({ publisher, kind, label, emptyHint }: DevicePickerProps) {
  const options = publisher.devices.filter((device) => device.kind === kind)
  const active = publisher.activeDeviceId(kind)
  const inputId = `device-picker-${kind}`

  return (
    <div className="device-picker">
      <label className="device-picker__label" htmlFor={inputId}>{label}</label>
      {options.length === 0
        ? <p className="device-picker__empty">{emptyHint}</p>
        : (
          <select
            id={inputId}
            className="device-picker__select"
            disabled={!publisher.canControl}
            /*
             * 브라우저 기본 장치를 쓰는 동안에는 getActiveDevice가 undefined거나 'default'다.
             * 그때는 목록 첫 항목을 고른 것처럼 보여 준다 — 빈 select는 "아무것도 안 잡혔다"로 읽힌다.
             */
            value={options.some((device) => device.deviceId === active)
              ? active
              : options[0].deviceId}
            onChange={(event) => publisher.switchDevice(kind, event.target.value)}
          >
            {options.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index)}</option>
            ))}
          </select>
        )}
    </div>
  )
}
