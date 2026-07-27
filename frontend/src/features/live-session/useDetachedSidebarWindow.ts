import { useCallback, useEffect, useRef, useState } from 'react'

type DetachedWindowMode = 'picture-in-picture' | 'popup'

interface DocumentPictureInPictureController {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
}

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController
}

const detachedStyleAttribute = 'data-liveclass-detached-style'

function copyPageStyles(targetDocument: Document) {
  targetDocument.head.querySelectorAll(`[${detachedStyleAttribute}]`).forEach((node) => node.remove())

  const base = targetDocument.createElement('base')
  base.href = document.baseURI
  base.setAttribute(detachedStyleAttribute, '')
  targetDocument.head.appendChild(base)

  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement
    clone.setAttribute(detachedStyleAttribute, '')
    targetDocument.head.appendChild(clone)
  })
}

function prepareDetachedWindow(detachedWindow: Window, title: string) {
  const { document: detachedDocument } = detachedWindow
  copyPageStyles(detachedDocument)
  detachedDocument.title = title
  detachedDocument.documentElement.lang = document.documentElement.lang || 'ko'
  detachedDocument.body.className = 'detached-sidebar-body'
  detachedDocument.body.replaceChildren()

  const root = detachedDocument.createElement('div')
  root.className = 'detached-sidebar-root'
  detachedDocument.body.appendChild(root)
  return root
}

export function useDetachedSidebarWindow(sessionId: string) {
  const detachedWindowRef = useRef<Window | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const [mode, setMode] = useState<DetachedWindowMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    const detachedWindow = detachedWindowRef.current
    detachedWindowRef.current = null
    setPortalContainer(null)
    setMode(null)
    setError(null)
    if (detachedWindow && !detachedWindow.closed) detachedWindow.close()
  }, [])

  const attach = useCallback((detachedWindow: Window, nextMode: DetachedWindowMode) => {
    const container = prepareDetachedWindow(detachedWindow, 'LiveClass 강의 운영 패널')
    detachedWindowRef.current = detachedWindow
    setPortalContainer(container)
    setMode(nextMode)

    detachedWindow.addEventListener('pagehide', () => {
      if (detachedWindowRef.current !== detachedWindow) return
      detachedWindowRef.current = null
      setPortalContainer(null)
      setMode(null)
    }, { once: true })
  }, [])

  const open = useCallback(async () => {
    const currentWindow = detachedWindowRef.current
    if (currentWindow && !currentWindow.closed) {
      currentWindow.focus()
      return
    }

    setError(null)
    const pictureInPicture = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture

    if (pictureInPicture) {
      try {
        const detachedWindow = await pictureInPicture.requestWindow({ width: 420, height: 780 })
        attach(detachedWindow, 'picture-in-picture')
      } catch {
        setError('항상 위 운영 패널을 열지 못했습니다. 브라우저의 Picture-in-Picture 권한을 확인해 주세요.')
      }
      return
    }

    const detachedWindow = window.open(
      '',
      `liveclass-sidebar-${sessionId}`,
      'popup=yes,width=420,height=780,resizable=yes,scrollbars=no',
    )
    if (!detachedWindow) {
      setError('운영 패널 팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.')
      return
    }
    attach(detachedWindow, 'popup')
  }, [attach, sessionId])

  useEffect(() => () => {
    const detachedWindow = detachedWindowRef.current
    detachedWindowRef.current = null
    if (detachedWindow && !detachedWindow.closed) detachedWindow.close()
  }, [])

  return {
    close,
    error,
    isDetached: Boolean(portalContainer),
    mode,
    open,
    portalContainer,
  }
}
