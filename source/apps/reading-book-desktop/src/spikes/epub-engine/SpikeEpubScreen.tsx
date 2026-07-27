import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CRITERIA,
  type CriterionResult,
  type EngineId,
  type Verdict,
} from './criteria'
import { openBaseline, type BaselineHandle } from './engines/baselineRunner'
import { openEpubjs, type EpubjsHandle } from './engines/epubjsRunner'
import { openFoliate, type FoliateHandle } from './engines/foliateRunner'

const FIXTURE_URL = '/spikes/spike-sample.epub'

type ActiveHandle =
  | { engine: 'epubjs'; handle: EpubjsHandle }
  | { engine: 'foliate'; handle: FoliateHandle }
  | { engine: 'baseline'; handle: BaselineHandle }

const ENGINE_LABEL: Record<EngineId, string> = {
  epubjs: 'epub.js (epubjs)',
  foliate: 'foliate-js',
  baseline: 'baseline (JSZip + iframe)',
}

function verdictColor(v: Verdict): string {
  if (v === 'Pass') return 'text-emerald-700'
  if (v === 'Partial') return 'text-amber-700'
  if (v === 'Fail') return 'text-red-700'
  return 'text-stone-500'
}

export function SpikeEpubScreen() {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<ActiveHandle | null>(null)
  const [engine, setEngine] = useState<EngineId>('epubjs')
  const [status, setStatus] = useState('Idle — pick engine and Open fixture')
  const [results, setResults] = useState<CriterionResult[]>([])
  const [busy, setBusy] = useState(false)
  const [dark, setDark] = useState(false)
  const [allResults, setAllResults] = useState<
    Partial<Record<EngineId, CriterionResult[]>>
  >({})

  useEffect(() => {
    return () => {
      activeRef.current?.handle.destroy()
      activeRef.current = null
    }
  }, [])

  const destroyActive = () => {
    activeRef.current?.handle.destroy()
    activeRef.current = null
  }

  const loadBuffer = async (): Promise<ArrayBuffer> => {
    const res = await fetch(FIXTURE_URL)
    if (!res.ok) {
      throw new Error(
        `Fixture missing at ${FIXTURE_URL}. Run: node spikes/epub-engine/build-fixture.mjs`,
      )
    }
    return res.arrayBuffer()
  }

  const openEngine = async (id: EngineId) => {
    const host = hostRef.current
    if (!host) return
    setBusy(true)
    setStatus(`Opening ${ENGINE_LABEL[id]}…`)
    destroyActive()
    setResults([])
    try {
      const buffer = await loadBuffer()
      if (id === 'epubjs') {
        const { handle, results: r } = await openEpubjs(buffer, host)
        activeRef.current = { engine: 'epubjs', handle }
        setResults(r)
        setAllResults((prev) => ({ ...prev, epubjs: r }))
      } else if (id === 'foliate') {
        const { handle, results: r } = await openFoliate(buffer, host)
        activeRef.current = { engine: 'foliate', handle }
        setResults(r)
        setAllResults((prev) => ({ ...prev, foliate: r }))
      } else {
        const { handle, results: r } = await openBaseline(buffer, host)
        activeRef.current = { engine: 'baseline', handle }
        setResults(r)
        setAllResults((prev) => ({ ...prev, baseline: r }))
      }
      setStatus(`Open OK — ${ENGINE_LABEL[id]}`)
    } catch (err) {
      setStatus(`Error: ${err}`)
      setResults([
        {
          id: 'open_arraybuffer',
          verdict: 'Fail',
          note: String(err),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  const runAll = async () => {
    setBusy(true)
    const order: EngineId[] = ['epubjs', 'foliate', 'baseline']
    const collected: Partial<Record<EngineId, CriterionResult[]>> = {}
    for (const id of order) {
      setEngine(id)
      setStatus(`Evaluating ${ENGINE_LABEL[id]}…`)
      const host = hostRef.current
      if (!host) break
      destroyActive()
      try {
        const buffer = await loadBuffer()
        if (id === 'epubjs') {
          const { handle, results: r } = await openEpubjs(buffer, host)
          activeRef.current = { engine: 'epubjs', handle }
          collected.epubjs = r
          setResults(r)
        } else if (id === 'foliate') {
          const { handle, results: r } = await openFoliate(buffer, host)
          activeRef.current = { engine: 'foliate', handle }
          collected.foliate = r
          setResults(r)
        } else {
          const { handle, results: r } = await openBaseline(buffer, host)
          activeRef.current = { engine: 'baseline', handle }
          collected.baseline = r
          setResults(r)
        }
      } catch (err) {
        collected[id] = [
          { id: 'open_arraybuffer', verdict: 'Fail', note: String(err) },
        ]
      }
    }
    setAllResults(collected)
    setStatus('All engines evaluated (see matrix below)')
    setBusy(false)
  }

  const onNext = async () => {
    const a = activeRef.current
    if (!a) return
    if (a.engine === 'epubjs') await a.handle.next()
    else if (a.engine === 'foliate') await a.handle.next()
    else a.handle.next()
  }

  const onPrev = async () => {
    const a = activeRef.current
    if (!a) return
    if (a.engine === 'epubjs') await a.handle.prev()
    else if (a.engine === 'foliate') await a.handle.prev()
    else a.handle.prev()
  }

  const onTheme = () => {
    const next = !dark
    setDark(next)
    activeRef.current?.handle.setTheme(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-stone-100 text-stone-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-300 px-3 py-2 text-sm">
        <strong className="mr-2">T3.1 EPUB engine spike</strong>
        <Link className="text-sky-700 underline" to="/library">
          ← Library
        </Link>
        <span className="text-stone-400">|</span>
        <span className="text-stone-600">
          Dev harness only — not wired from Library → Reader
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-3 py-2 text-sm">
        {(Object.keys(ENGINE_LABEL) as EngineId[]).map((id) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            className={`rounded border px-2 py-1 ${
              engine === id
                ? 'border-sky-600 bg-sky-50'
                : 'border-stone-300 bg-white'
            }`}
            onClick={() => setEngine(id)}
          >
            {ENGINE_LABEL[id]}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          className="rounded bg-sky-700 px-3 py-1 text-white disabled:opacity-50"
          onClick={() => void openEngine(engine)}
        >
          Open fixture
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-stone-400 bg-white px-3 py-1 disabled:opacity-50"
          onClick={() => void runAll()}
        >
          Run all evals
        </button>
        <button
          type="button"
          disabled={busy || !activeRef.current}
          className="rounded border border-stone-300 bg-white px-2 py-1"
          onClick={() => void onPrev()}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={busy || !activeRef.current}
          className="rounded border border-stone-300 bg-white px-2 py-1"
          onClick={() => void onNext()}
        >
          Next
        </button>
        <button
          type="button"
          disabled={busy || !activeRef.current}
          className="rounded border border-stone-300 bg-white px-2 py-1"
          onClick={onTheme}
        >
          Theme {dark ? 'light' : 'dark'}
        </button>
        <span className="text-stone-600">{status}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1fr_22rem]">
        <div
          ref={hostRef}
          className="min-h-[320px] overflow-hidden bg-white lg:min-h-0"
        />
        <aside className="overflow-auto border-l border-stone-200 bg-white p-3 text-xs">
          <h2 className="mb-2 text-sm font-semibold">Criteria — {ENGINE_LABEL[engine]}</h2>
          <ul className="mb-4 space-y-2">
            {CRITERIA.map((c) => {
              const r = results.find((x) => x.id === c.id)
              return (
                <li key={c.id} className="border-b border-stone-100 pb-1">
                  <div className="flex justify-between gap-2">
                    <span>
                      {c.label}
                      {c.required ? ' *' : ''}
                    </span>
                    <span className={`font-semibold ${verdictColor(r?.verdict ?? 'Pending')}`}>
                      {r?.verdict ?? 'Pending'}
                    </span>
                  </div>
                  {r?.note ? (
                    <p className="mt-0.5 text-stone-500">{r.note}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <h2 className="mb-2 text-sm font-semibold">Session matrix</h2>
          {(Object.keys(ENGINE_LABEL) as EngineId[]).map((id) => (
            <div key={id} className="mb-3">
              <div className="font-medium">{ENGINE_LABEL[id]}</div>
              {allResults[id] ? (
                <ul className="mt-1 space-y-0.5">
                  {allResults[id]!.map((r) => (
                    <li key={r.id} className={verdictColor(r.verdict)}>
                      [{r.verdict}] {r.id}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-stone-400">Not run yet</p>
              )}
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
