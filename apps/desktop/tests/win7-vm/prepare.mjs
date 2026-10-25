/** Adapt the existing owned ZCode Hyper-V harness without changing its source or product profiles. */
import { mkdir, readFile, realpath, writeFile, copyFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [artifact, reference = 'D:/ZCode-oss'] = process.argv.slice(2)
if (!artifact) throw new Error('Usage: node apps/desktop/tests/win7-vm/prepare.mjs <portable-directory> [ZCode-source-root]')
const helpers = join(await realpath(reference), 'tools', 'win7-vm')
const own = dirname(fileURLToPath(import.meta.url))
const runId = `dsh-${new Date().toISOString().replace(/[-:.]/gu, '')}-${randomUUID().slice(0, 8)}`
const runRoot = join('D:/VMs/Win7/validation-runs', runId)
const helperRoot = join(runRoot, 'helpers')
await mkdir(helperRoot, { recursive: true })
await mkdir(join(helperRoot, 'fixtures'))
for (const name of ['control-core.mjs', 'OfflineRegistry.cs', 'admin-session.ps1']) await copyFile(join(helpers, name), join(helperRoot, name))
let setup = await readFile(join(helpers, 'setup.ps1'), 'utf8')
if (!setup.includes("$guestRoot=Join-Path $data 'zcode-validation'")) throw new Error('ZCode setup script has changed; review the adapter')
setup = setup.replaceAll('zcode-validation', `dsh-validation-${runId}`).replaceAll('ZCode.exe', 'DshHarness.exe')
const helperFiles = "@('guest.mjs','control-core.mjs','diagnostic-probe.mjs')"
if (!setup.includes(helperFiles)) throw new Error('ZCode guest helper deployment has changed; review the adapter')
setup = setup.replace(helperFiles, "@('guest.mjs','control-core.mjs','diagnostic-probe.mjs','python-smoke.py')")
await writeFile(join(helperRoot, 'setup.ps1'), setup)
const baseGuest = await readFile(join(helpers, 'guest.mjs'), 'utf8')
const transportStart = baseGuest.indexOf('const proxy = createServer(')
if (transportStart < 0) throw new Error('ZCode authenticated guest transport is missing')
await writeFile(join(helperRoot, 'guest.mjs'), `${await readFile(join(own, 'guest-prefix.mjs.template'), 'utf8')}\n${baseGuest.slice(transportStart)}`)
await copyFile(join(own, 'probe.mjs'), join(helperRoot, 'diagnostic-probe.mjs'))
await copyFile(join(own, '../../../../scripts/primary-runtime/smoke.py'), join(helperRoot, 'python-smoke.py'))
await writeFile(join(helperRoot, 'fixtures', 'diagnostic-provider.json'), '{}\n')
const config = { runRoot, runId, hostIp: '172.28.151.1', guestIp: '172.28.151.2', port: 21571, proxyPort: 9258,
  token: randomBytes(32).toString('hex'), artifactRoot: await realpath(artifact), helperRoot, referenceRoot: await realpath(reference) }
await writeFile(join(runRoot, 'host-config.json'), `${JSON.stringify(config, undefined, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(join(runRoot, 'host-config.json'))
