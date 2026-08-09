import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DeviceSettingsButton from '@/features/live-session/DeviceSettingsButton'
import type { InstructorLiveMedia } from '@/features/live-session/useInstructorLiveKit'

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { deviceId, kind, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo
}

const DEVICES = [
  device('videoinput', 'cam-1', '내장 카메라'),
  device('videoinput', 'cam-2', '외장 웹캠'),
  device('audioinput', 'mic-1', '내장 마이크'),
]

function renderButton(overrides: Partial<InstructorLiveMedia> = {}) {
  const switchDevice = vi.fn()
  const publisher = {
    devices: DEVICES,
    canControl: true,
    activeDeviceId: () => undefined,
    switchDevice,
    ...overrides,
  } as unknown as InstructorLiveMedia
  render(<DeviceSettingsButton publisher={publisher} />)
  return { switchDevice }
}

const openButton = () => screen.getByRole('button', { name: '입력 장치 설정' })

describe('DeviceSettingsButton', () => {
  it('처음에는 접혀 있다', () => {
    // 컨트롤 줄은 영상 위에 떠 있다 — 열어 둔 채로 두면 화면을 가린다.
    renderButton()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('누르면 카메라와 마이크를 함께 펼친다', async () => {
    renderButton()

    await userEvent.click(openButton())

    expect(screen.getByRole('dialog', { name: '입력 장치 설정' })).toBeInTheDocument()
    expect(screen.getByLabelText('카메라')).toBeInTheDocument()
    expect(screen.getByLabelText('마이크')).toBeInTheDocument()
  })

  it('펼친 뒤 고르면 그 장치로 바꾼다', async () => {
    const { switchDevice } = renderButton()

    await userEvent.click(openButton())
    await userEvent.selectOptions(screen.getByLabelText('카메라'), 'cam-2')

    expect(switchDevice).toHaveBeenCalledWith('videoinput', 'cam-2')
  })

  it('바깥을 누르면 닫힌다', async () => {
    renderButton()
    await userEvent.click(openButton())

    await userEvent.click(document.body)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape로도 닫힌다', async () => {
    renderButton()
    await userEvent.click(openButton())

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('연 직후 곧바로 닫히지 않는다', async () => {
    /*
     * 바깥 클릭을 pointerdown이 아니라 click으로 들으면, 버튼을 누른 그 클릭이 패널이 열린 뒤에
     * 도착해 방금 연 것을 그대로 닫는다. 열자마자 사라지는 버튼이 된다.
     */
    renderButton()

    await userEvent.click(openButton())

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('송출을 조작할 수 없으면 열 수 없다', () => {
    // 연결 전에는 바꿔도 반영될 곳이 없다.
    renderButton({ canControl: false })

    expect(openButton()).toBeDisabled()
  })
})
