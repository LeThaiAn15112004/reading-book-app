/**
 * Double-click-to-switch for typewriter:
 * Click 1 while editing → commit/blur current session only.
 * Click 2 (idle) → activate the new target or place a new box.
 */

export type TypewriterFocusSession = {
  /** True after a commit in this pointer gesture — block activate until gesture ends. */
  suppressActivate: boolean
}

export function createTypewriterFocusSession(): TypewriterFocusSession {
  return { suppressActivate: false }
}

/** Mark that this gesture already committed — ignore activate/place until cleared. */
export function armTypewriterCommitSuppress(
  session: TypewriterFocusSession,
): void {
  session.suppressActivate = true
}

export function clearTypewriterCommitSuppress(
  session: TypewriterFocusSession,
): void {
  session.suppressActivate = false
}

/**
 * Returns true if the caller may activate a new edit target / place a new box.
 * Returns false when a session was committed instead (or same-gesture suppress).
 */
export function requestTypewriterActivation(input: {
  session: TypewriterFocusSession
  activeEditingId: string | null
  hasDraft: boolean
  /** Same id already focused — allow no-op without committing. */
  targetId?: string | null
  commitEditing: (id: string) => void
  commitDraft: () => void
}): boolean {
  const {
    session,
    activeEditingId,
    hasDraft,
    targetId,
    commitEditing,
    commitDraft,
  } = input

  if (targetId && activeEditingId === targetId) return true

  if (activeEditingId) {
    commitEditing(activeEditingId)
    armTypewriterCommitSuppress(session)
    return false
  }

  if (hasDraft) {
    commitDraft()
    armTypewriterCommitSuppress(session)
    return false
  }

  if (session.suppressActivate) return false
  return true
}
