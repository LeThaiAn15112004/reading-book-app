// Spec 010 T027: imported FIRST by main.ts — ES modules run their imports in order, so this executes before any other
// Main module that might read userData. Store build only (see store-runtime.ts); a no-op for the direct build.
import { applyStoreUserData } from './store-runtime'

applyStoreUserData()
