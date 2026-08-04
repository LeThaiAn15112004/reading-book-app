import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type ReaderChromeControls = {
  toolsOpen: boolean
  openTools: () => void
  closeTools: () => void
  toggleTools: () => void
}

type ReaderChromeMenuContextValue = {
  controls: ReaderChromeControls | null
  registerReaderChrome: (controls: ReaderChromeControls | null) => void
}

const ReaderChromeMenuContext =
  createContext<ReaderChromeMenuContextValue | null>(null)

export function ReaderChromeMenuProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<ReaderChromeControls | null>(null)

  const registerReaderChrome = useCallback(
    (nextControls: ReaderChromeControls | null) => {
      setControls(nextControls)
    },
    [],
  )

  const value = useMemo(
    () => ({ controls, registerReaderChrome }),
    [controls, registerReaderChrome],
  )

  return (
    <ReaderChromeMenuContext.Provider value={value}>
      {children}
    </ReaderChromeMenuContext.Provider>
  )
}

export function useReaderChromeMenu(): ReaderChromeMenuContextValue {
  const context = useContext(ReaderChromeMenuContext)
  if (!context) {
    throw new Error(
      'useReaderChromeMenu must be used within ReaderChromeMenuProvider',
    )
  }
  return context
}
