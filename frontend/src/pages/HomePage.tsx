import { useState } from 'react'
import type { UIEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConferenceCard } from '@/components/ConferenceCard'

const INITIAL_CARD_COUNT = 12
const LOAD_SIZE = 4

export function HomePage() {
  const navigate = useNavigate()
  const [count, setCount] = useState(INITIAL_CARD_COUNT)

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 10) {
      setCount((current) => current + LOAD_SIZE)
    }
  }

  return (
    <div className="conference-scroll" onScroll={handleScroll} data-testid="conference-scroll">
      <ul className="conference-grid">
        {Array.from({ length: count }, (_, index) => {
          const conferenceId = index + 1
          return (
            <li key={conferenceId}>
              <button
                className="conference-link"
                type="button"
                aria-label={`${conferenceId}번 회의 상세 보기`}
                onClick={() => navigate(`/conferences/${conferenceId}`)}
              >
                <ConferenceCard />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
