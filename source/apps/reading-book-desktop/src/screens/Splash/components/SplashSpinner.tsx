/** Bottom-center loading indicator while Main/DB boot. */
export function SplashSpinner() {
  return (
    <div
      className="absolute bottom-12 h-6 w-6 animate-spin rounded-full border-2 border-lib-border border-t-lib-accent"
      role="status"
      aria-label="Loading"
    />
  )
}
