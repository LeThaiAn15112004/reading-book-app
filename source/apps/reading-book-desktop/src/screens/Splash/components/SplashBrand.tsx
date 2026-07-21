function SplashBookIcon() {
  return (
    <div className="mb-6 h-20 w-20 animate-splash-pulse text-[#f59e0b] drop-shadow-[0_0_15px_rgba(245,158,11,0.3)]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.2}
        stroke="currentColor"
        aria-hidden
      >
        <path
          className="animate-splash-draw-book [stroke-dasharray:1000] [stroke-dashoffset:1000]"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
        />
      </svg>
    </div>
  )
}

/** Brand mark: book icon + Readmate / Reader. */
export function SplashBrand() {
  return (
    <div className="flex flex-col items-center text-center">
      <SplashBookIcon />
      <h1 className="animate-splash-fade-in-up translate-y-2.5 text-2xl font-light uppercase tracking-[0.3em] text-[#e2e8f0] opacity-0 delay-500">
        Readmate
      </h1>
      <p className="animate-splash-fade-in-up mt-2 translate-y-2.5 text-[11px] font-light uppercase tracking-[0.45em] text-[#64748b] opacity-0 delay-[800ms]">
        Reader
      </p>
    </div>
  )
}
