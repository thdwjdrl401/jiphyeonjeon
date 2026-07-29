import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InstructorLiveMediaProvider, {
  useInstructorLiveKit,
} from '@/features/live-session/InstructorLiveMediaProvider'

const liveKit = vi.hoisted(() => {
  const localParticipant = {
    isCameraEnabled: false,
    isMicrophoneEnabled: false,
    isScreenShareEnabled: false,
    getTrackPublication: vi.fn(),
    setCameraEnabled: vi.fn(async (enabled: boolean) => {
      localParticipant.isCameraEnabled = enabled
    }),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      localParticipant.isMicrophoneEnabled = enabled
    }),
    setScreenShareEnabled: vi.fn(async (enabled: boolean) => {
      localParticipant.isScreenShareEnabled = enabled
    }),
  }
  const room = {
    localParticipant,
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  room.on.mockImplementation(() => room)
  room.off.mockImplementation(() => room)

  return { localParticipant, room }
})

const liveSessionApi = vi.hoisted(() => ({
  preparePreflightRoom: vi.fn(),
  getInstructorLiveToken: vi.fn(),
}))

vi.mock('@/shared/config/runtime', () => ({
  isMockApiEnabled: false,
  isTestMode: true,
}))

vi.mock('@/features/live-session/liveSessionService', () => liveSessionApi)

vi.mock('livekit-client', () => ({
  LocalVideoTrack: class LocalVideoTrack {},
  MediaDeviceFailure: {
    PermissionDenied: 'PermissionDenied',
    NotFound: 'NotFound',
    DeviceInUse: 'DeviceInUse',
    getFailure: vi.fn(),
  },
  VideoPresets: {
    h1080: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 3_000_000 } },
    h720: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 1_700_000 } },
    h540: { resolution: { width: 960, height: 540 }, encoding: { maxBitrate: 1_000_000 } },
  },
  ScreenSharePresets: {
    h1080fps30: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 5_000_000 } },
    h1080fps15: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 2_500_000 } },
    h720fps30: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 3_000_000 } },
  },
  Room: vi.fn(() => liveKit.room),
  RoomEvent: {
    Reconnecting: 'Reconnecting',
    Reconnected: 'Reconnected',
    Disconnected: 'Disconnected',
    MediaDevicesError: 'MediaDevicesError',
    LocalTrackPublished: 'LocalTrackPublished',
    LocalTrackUnpublished: 'LocalTrackUnpublished',
    TrackMuted: 'TrackMuted',
    TrackUnmuted: 'TrackUnmuted',
  },
  Track: {
    Source: {
      Camera: 'Camera',
      ScreenShare: 'ScreenShare',
    },
  },
}))

function ProviderStateProbe() {
  const publisher = useInstructorLiveKit()
  return (
    <output>
      {[
        publisher.sessionId,
        publisher.connectionState,
        String(publisher.microphoneEnabled),
        String(publisher.cameraEnabled),
        String(publisher.canControl),
      ].join('|')}
    </output>
  )
}

describe('InstructorLiveMediaProvider', () => {
  beforeEach(() => {
    liveKit.localParticipant.isCameraEnabled = false
    liveKit.localParticipant.isMicrophoneEnabled = false
    liveKit.localParticipant.isScreenShareEnabled = false
    liveKit.room.connect.mockResolvedValue(undefined)
    liveKit.room.disconnect.mockResolvedValue(undefined)
    liveSessionApi.preparePreflightRoom.mockResolvedValue({
      sessionId: 'session-1',
      roomName: 'session-session-1',
      roomSid: 'RM_1',
    })
    liveSessionApi.getInstructorLiveToken.mockResolvedValue({
      token: 'publisher-token',
      wsUrl: 'wss://live.example.test',
    })
  })

  it('강사 전용 토큰을 받아 연결하고 Provider 상태를 소비자에게 전달한다', async () => {
    render(
      <MemoryRouter initialEntries={['/instructor/live-sessions/session-1/preflight']}>
        <Routes>
          <Route
            path="/instructor/live-sessions/:sessionId/preflight"
            element={(
              <InstructorLiveMediaProvider>
                <ProviderStateProbe />
              </InstructorLiveMediaProvider>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'session-1|connected|true|true|true',
      )
    })

    expect(liveSessionApi.preparePreflightRoom).toHaveBeenCalledWith('session-1')
    expect(liveSessionApi.getInstructorLiveToken).toHaveBeenCalledWith('session-1')
    expect(liveSessionApi.preparePreflightRoom.mock.invocationCallOrder[0])
      .toBeLessThan(liveSessionApi.getInstructorLiveToken.mock.invocationCallOrder[0])
    expect(liveKit.room.connect).toHaveBeenCalledWith(
      'wss://live.example.test',
      'publisher-token',
      { autoSubscribe: false },
    )
  })
})
