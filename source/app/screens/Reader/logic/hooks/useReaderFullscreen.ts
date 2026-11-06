import { useImmersiveReading } from '../../../../components/chrome'

/**
 * Reader fullscreen controls — backed by the app-wide immersive reading context
 * (OS fullscreen + Reader route).
 */
export function useReaderFullscreen() {
  const { fullscreen, toggleFullscreen, exitFullscreen } = useImmersiveReading()
  return {
    fullscreen,
    toggleFullscreen,
    exitFullscreen,
  }
}
