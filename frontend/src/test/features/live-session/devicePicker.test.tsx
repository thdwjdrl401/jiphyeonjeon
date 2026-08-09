import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DevicePicker from '@/features/live-session/DevicePicker'
import type { InstructorLiveMedia } from '@/features/live-session/useInstructorLiveKit'

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { deviceId, kind, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo
}

function publisherWith(
  devices: MediaDeviceInfo[],
  overrides: Partial<InstructorLiveMedia> = {},
): InstructorLiveMedia {
  return {
    devices,
    canControl: true,
    activeDeviceId: () => undefined,
    switchDevice: vi.fn(),
    ...overrides,
  } as unknown as InstructorLiveMedia
}

const CAMERAS = [
  device('videoinput', 'cam-1', '내장 카메라'),
  device('videoinput', 'cam-2', 'HD Pro Webcam C920'),
]

function renderPicker(publisher: InstructorLiveMedia, kind: MediaDeviceKind = 'videoinput') {
  render(
    <DevicePicker publisher={publisher} kind={kind} label="카메라" emptyHint="연결된 카메라가 없습니다." />,
  )
}

describe('DevicePicker', () => {
  it('그 종류의 장치만 고를 수 있게 한다', () => {
    renderPicker(publisherWith([...CAMERAS, device('audioinput', 'mic-1', '내장 마이크')]))

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['내장 카메라', 'HD Pro Webcam C920'])
  })

  it('고르면 그 장치로 바꾼다', async () => {
    const switchDevice = vi.fn()
    renderPicker(publisherWith(CAMERAS, { switchDevice }))

    await userEvent.selectOptions(screen.getByRole('combobox'), 'cam-2')

    expect(switchDevice).toHaveBeenCalledWith('videoinput', 'cam-2')
  })

  it('지금 쓰는 장치를 선택 상태로 보여 준다', () => {
    renderPicker(publisherWith(CAMERAS, { activeDeviceId: () => 'cam-2' }))

    expect(screen.getByRole('combobox')).toHaveValue('cam-2')
  })

  it('브라우저 기본값이라 활성 장치를 모를 때도 빈칸으로 두지 않는다', () => {
    /*
     * getActiveDevice는 기본 장치를 쓰는 동안 undefined거나 목록에 없는 'default'를 준다.
     * 그대로 두면 select가 빈칸이 되어 "아무것도 안 잡혔다"로 읽힌다.
     */
    renderPicker(publisherWith(CAMERAS, { activeDeviceId: () => 'default' }))

    expect(screen.getByRole('combobox')).toHaveValue('cam-1')
  })

  it('라벨이 없으면 순번이라도 붙인다', () => {
    // 권한 전에는 브라우저가 label을 빈 문자열로 준다 — 빈칸만 늘어서면 몇 개인지도 모른다.
    renderPicker(publisherWith([
      device('videoinput', 'cam-1', ''),
      device('videoinput', 'cam-2', ''),
    ]))

    expect(screen.getAllByRole('option').map((option) => option.textContent))
      .toEqual(['장치 1', '장치 2'])
  })

  it('고를 것이 없으면 왜 없는지 말한다', () => {
    renderPicker(publisherWith([]))

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('연결된 카메라가 없습니다.')).toBeInTheDocument()
  })

  it('조작할 수 없는 동안에는 잠근다', () => {
    // 연결 전에 고르면 아무 일도 일어나지 않는다 — 눌리는데 안 바뀌면 고장으로 읽힌다.
    renderPicker(publisherWith(CAMERAS, { canControl: false }))

    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
