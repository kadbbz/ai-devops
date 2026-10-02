import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { entity, fingerprint, check, type State } from './domain.js'
export const fileRoot = () => process.env.FILE_ROOT || '.data/files'
export async function saveFile(
  s: State,
  projectId: string,
  content: string | Buffer,
  name: string,
  contentType = 'application/json'
) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
  check(buffer.length <= 5 * 1024 * 1024, 'FILE_TOO_LARGE', '文件不能超过 5 MB', 413)
  const file = entity('file', {
    projectId,
    name: name.replace(/[^\p{L}\p{N}._-]/gu, '_'),
    sha256: fingerprint(buffer),
    contentType,
    sizeBytes: buffer.length,
    retentionUntil: new Date(Date.now() + 90 * 86400000).toISOString()
  })
  file.storageKey = file.id
  await mkdir(fileRoot(), { recursive: true })
  await writeFile(join(fileRoot(), file.id), buffer, { mode: 0o600 })
  s.file_objects.push(file)
  return file
}
export async function readObject(file: any) {
  const buffer = await readFile(join(fileRoot(), file.id))
  check(fingerprint(buffer) === file.sha256, 'FILE_INTEGRITY', '文件校验失败', 409)
  return buffer
}
