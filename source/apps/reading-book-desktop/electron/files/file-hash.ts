import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { createReadStream } from 'node:fs'

export interface FileHashResult {
  sha256: string
  fileSizeBytes: number
}

/** SHA-256 hex digest + byte size for a local file (T2.6 / feeds T2.7). */
export async function hashFile(filePath: string): Promise<FileHashResult> {
  const stat = await fsp.stat(filePath)
  const hash = createHash('sha256')

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })

  return {
    sha256: hash.digest('hex'),
    fileSizeBytes: stat.size,
  }
}
