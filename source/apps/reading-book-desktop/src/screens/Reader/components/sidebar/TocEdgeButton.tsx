type TocEdgeButtonProps = {
  onOpen: () => void
}

export function TocEdgeButton({ onOpen }: TocEdgeButtonProps) {
  return (
    <button
      className="group fixed top-0 bottom-14 left-0 z-[80] flex w-7 cursor-pointer items-center justify-center border-none bg-transparent text-lib-muted transition-[width] hover:w-[34px] hover:bg-gradient-to-r hover:from-lib-bg-deep/55 hover:to-transparent hover:text-lib-accent sm:bottom-16"
      type="button"
      title="Open table of contents"
      aria-label="Open table of contents"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-transparent group-hover:bg-lib-accent" />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.4}
        stroke="currentColor"
        className="size-4 opacity-55 group-hover:opacity-100"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m8.25 4.5 7.5 7.5-7.5 7.5"
        />
      </svg>
    </button>
  )
}
