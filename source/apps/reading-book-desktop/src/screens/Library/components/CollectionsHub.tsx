import type { CollectionSummary } from '../libraryModel'

const STACK_GRADS = [
  'linear-gradient(135deg, #1e3a8a, #3b82f6)',
  'linear-gradient(135deg, #581c87, #8b5cf6)',
  'linear-gradient(135deg, #064e3b, #10b981)',
  'linear-gradient(135deg, #7c2d12, #f97316)',
  'linear-gradient(135deg, #831843, #ec4899)',
] as const

function stackFor(id: string): [string, string, string] {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % 5
  const a = hash % 5
  return [
    STACK_GRADS[a],
    STACK_GRADS[(a + 1) % 5],
    STACK_GRADS[(a + 2) % 5],
  ]
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

export type CollectionsHubProps = {
  collections: CollectionSummary[]
  onNewCollection: () => void
  onOpenCollection: (id: string) => void
}

/** FR-14 / T1.9a — Collections hub: list COLLECTION + New collection CTA. */
export function CollectionsHub({
  collections,
  onNewCollection,
  onOpenCollection,
}: CollectionsHubProps) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="region"
      aria-label="Collections"
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-lib-border-soft bg-lib-topbar px-7 backdrop-blur-sm">
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[22px] leading-tight font-semibold tracking-tight text-lib-text-strong">
            Collections
          </h1>
          <p className="m-0 mt-0.5 text-[13px] text-lib-muted">
            Group books into sets you curate yourself
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-lib-accent px-4 text-[13px] font-semibold text-lib-bg-deep shadow-[0_4px_14px_rgba(245,158,11,0.22)] transition-colors hover:bg-lib-accent-hover"
          onClick={onNewCollection}
        >
          <PlusIcon className="size-4" />
          <span>New collection</span>
        </button>
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto px-7 py-7">
        {collections.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
            <p className="m-0 mb-2 text-base font-semibold text-lib-text-strong">
              No collections yet
            </p>
            <p className="m-0 mb-6 text-sm leading-relaxed text-lib-muted">
              Create a set to group books by topic or purpose — beyond shelves and
              favorites.
            </p>
            <button
              type="button"
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border-none bg-lib-accent px-5 text-[13px] font-semibold text-lib-bg-deep transition-colors hover:bg-lib-accent-hover"
              onClick={onNewCollection}
            >
              <PlusIcon className="size-4" />
              <span>New collection</span>
            </button>
          </div>
        ) : (
          <div
            className="mx-auto grid w-full max-w-[1100px] grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
            role="list"
          >
            {collections.map((c) => {
              const [g1, g2, g3] = stackFor(c.id)
              const count =
                c.bookIds.length === 1
                  ? '1 book'
                  : `${c.bookIds.length} books`
              return (
                <button
                  key={c.id}
                  type="button"
                  role="listitem"
                  className="flex cursor-pointer flex-col gap-3.5 rounded-xl border border-lib-border-soft bg-lib-surface p-[18px] text-left font-[inherit] text-inherit transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-lib-accent-ring hover:bg-[rgb(30_41_59/0.65)]"
                  onClick={() => onOpenCollection(c.id)}
                >
                  <div
                    className="grid h-[72px] grid-cols-3 gap-1.5"
                    aria-hidden
                  >
                    <span
                      className="rounded-md opacity-90"
                      style={{ background: g1 }}
                    />
                    <span
                      className="rounded-md opacity-90"
                      style={{ background: g2 }}
                    />
                    <span
                      className="rounded-md opacity-90"
                      style={{ background: g3 }}
                    />
                  </div>
                  <div>
                    <h2 className="m-0 mb-1 text-base font-semibold text-lib-text-strong">
                      {c.name}
                    </h2>
                    {c.description ? (
                      <p className="m-0 text-[13px] leading-snug text-lib-muted">
                        {c.description}
                      </p>
                    ) : null}
                    <div className="mt-2.5 text-xs font-semibold text-lib-faint">
                      {count}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
