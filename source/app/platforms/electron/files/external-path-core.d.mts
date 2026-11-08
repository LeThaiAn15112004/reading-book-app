// Types of external-path-core.mjs (the Desktop tsconfig has no allowJs).

export function packageFamilyNameFromExecPath(execPath: string): string | null

export function mapForOtherApps(
  p: string,
  options: { userData: string; localAppData: string | undefined; pfn: string | null },
): string
