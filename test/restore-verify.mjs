import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const backup = process.argv[2]
const prefix = process.argv[3]
assert.ok(
  backup && /^devops-restore-\d+$/.test(prefix),
  'Usage: restore-verify.mjs backup-directory recovery-prefix'
)
const expected = JSON.parse(readFileSync(`${backup}/manifest.json`))
const report = {
  verifiedAt: new Date().toISOString(),
  backupAt: expected.createdAt,
  recoveryPrefix: prefix,
  fileCounts: {},
  matches: []
}
for (const volume of ['platform_files', 'audit_logs', 'git_data', 'git_config']) {
  const contents = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      'root',
      '-v',
      `${prefix}-${volume}:/restored:ro`,
      '--entrypoint',
      'node',
      'ai-devops-platform:local',
      '--input-type=module',
      '-e',
      `import {readdirSync,readFileSync,lstatSync} from 'node:fs';import {createHash} from 'node:crypto';const rows={};function walk(path){for(const name of readdirSync(path)){const p=path+'/'+name;const st=lstatSync(p);if(st.isDirectory())walk(p);else if(st.isFile())rows[p.slice(10)]=createHash('sha256').update(readFileSync(p)).digest('hex')}}walk('/restored');console.log(JSON.stringify(rows))`
    ],
    { encoding: 'utf8' }
  )
  const actual = JSON.parse(contents)
  const archived = execFileSync(
    'python3',
    [
      '-c',
      `import tarfile,hashlib,json,sys
with tarfile.open(sys.argv[1]) as archive:
 print(json.dumps({m.name.removeprefix('./'):hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers() if m.isfile()}))`,
      `${backup}/${volume}.tgz`
    ],
    { encoding: 'utf8' }
  )
  const original = JSON.parse(archived)
  assert.deepEqual(actual, original, `${volume} file content mismatch`)
  report.fileCounts[volume] = Object.keys(actual).length
  report.matches.push(volume)
}
writeFileSync(
  new URL('../doc/validation/restore-check.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n'
)
console.log(JSON.stringify(report, null, 2))
