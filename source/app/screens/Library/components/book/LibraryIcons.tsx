/** Small SVG icons for Library chrome (same 24-unit outline style as the sidebar / toolbar icons). */

const STAR_PATH =
  'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z'

/** Favorite star; `filled` for a favorite, outline otherwise. Decorative: label the control that holds it. */
export function StarIcon({ filled = false, className }: { filled?: boolean; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={STAR_PATH} />
    </svg>
  )
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

/** "Add to collection" (a stack with a plus). Decorative: label the control that holds it. */
export function CollectionAddIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0A2.25 2.25 0 0 0 3.75 9.128v8.622A2.25 2.25 0 0 0 6 20h12a2.25 2.25 0 0 0 2.25-2.25V9.128A2.25 2.25 0 0 0 18 6.878m-12 0h12M12 10.5v6m3-3H9"
      />
    </svg>
  )
}

/** Remove (a bin). Decorative: label the control that holds it. */
export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  )
}

/** Selection mark on a book card / row in select mode: a ring, filled with a tick when the book is picked. */
export function SelectionMark({ selected, className = '' }: { selected: boolean; className?: string }) {
  return (
    <span
      className={`pointer-events-none inline-flex size-6 items-center justify-center rounded-full border-2 shadow-[0_1px_3px_rgba(0,0,0,0.35)] ${
        selected ? 'border-lib-accent bg-lib-accent text-white' : 'border-white bg-black/30'
      } ${className}`}
      aria-hidden
    >
      {selected ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="size-3.5" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      ) : null}
    </span>
  )
}
