import { useAppTitle } from './AppTitleContext'

/** Native Windows/Linux caption buttons sit in the reserved right inset. */
export function AppTitlebar() {
  const { isReaderRoute, documentSubtitle } = useAppTitle()

  return (
    <header
      className={`app-window-titlebar${isReaderRoute ? ' is-reader' : ''}`}
      role="banner"
    >
      {documentSubtitle ? (
        <div className="app-window-titlebar-center" title={documentSubtitle}>
          {documentSubtitle}
        </div>
      ) : null}
    </header>
  )
}
