import { useAppTitle } from './AppTitleContext'

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  )
}

/** Native Windows/Linux caption buttons sit in the reserved right inset. */
export function AppTitlebar() {
  const {
    isReaderRoute,
    documentSubtitle,
    readerSearchQuery,
    setReaderSearchQuery,
    requestReaderSearch,
  } = useAppTitle()

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

      {isReaderRoute ? (
        <form
          className="app-window-titlebar-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            requestReaderSearch()
          }}
        >
          <SearchIcon className="app-window-titlebar-search-icon" />
          <input
            type="search"
            value={readerSearchQuery}
            onChange={(e) => setReaderSearchQuery(e.target.value)}
            placeholder="Search in book…"
            aria-label="Search in book"
            autoComplete="off"
            spellCheck={false}
          />
        </form>
      ) : null}
    </header>
  )
}
