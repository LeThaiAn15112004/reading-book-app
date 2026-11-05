/**
 * In Expo Go the UI comes from `http://{computer}`, which is not a secure context, so these browser APIs are missing
 * while Desktop's UI calls them directly (specs/008, research R13). Each is added only when absent, so a secure
 * page, including the real app on 127.0.0.1, keeps the browser's own.
 */
function randomUuid(): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function installSecureContextShims(): void {
  if (typeof crypto.randomUUID !== 'function') {
    Object.defineProperty(crypto, 'randomUUID', { value: randomUuid, configurable: true })
  }
  if (!navigator.clipboard) {
    const unavailable = () => Promise.reject(new DOMException('Clipboard needs a secure page', 'NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: unavailable, readText: unavailable },
      configurable: true,
    })
  }
}
