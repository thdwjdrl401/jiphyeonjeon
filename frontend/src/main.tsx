import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/auth.css'
import './styles/curriculum-detail.css'
import './styles/workspace.css'
import './styles/learning.css'
import './styles/toast.css'
import './styles/notification.css'
import './styles/design-system.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('앱을 마운트할 root 요소를 찾을 수 없습니다.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
