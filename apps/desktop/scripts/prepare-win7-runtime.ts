/** Checksum-pinned Windows 7 interpreters for the isolated portable Desktop target. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import extractZip from 'extract-zip'
import { downloadPrimaryRuntimeAsset, unpackPrimaryRuntimeWheel } from '../../../scripts/primary-runtime/prepare.ts'
import { prunePrimaryRuntimePythonTests } from '../../../scripts/primary-runtime/prune-python-tests.ts'
import primaryLock from '../../../scripts/primary-runtime/lock.json' with { type: 'json' }
import lock from './win7-runtime-lock.json' with { type: 'json' }

/**
 * Reject invalid compatibility selections before any build output is changed.
 * @param environment - Desktop preparation environment.
 * @returns Whether the Windows 7 portable target was selected.
 */
export function isWin7Build(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment.DSH_DESKTOP_WIN7
  if (value !== undefined && value !== '0' && value !== '1') throw new Error('DSH_DESKTOP_WIN7 must be 0 or 1')
  if (value === '1' && (process.platform !== 'win32' || process.arch !== 'x64')) {
    throw new Error('Windows 7 portable preparation requires a Windows x64 build host')
  }
  return value === '1'
}

/**
 * Extract the pinned Windows 7 Electron distribution.
 * @param destination - Empty runtime directory.
 * @param cache - Verified download cache.
 * @returns Resolves after archive verification and extraction.
 */
export async function prepareWin7Electron(destination: string, cache: string): Promise<void> {
  const archive = await downloadPrimaryRuntimeAsset(lock.electron.url, lock.electron.sha256, cache)
  mkdirSync(destination, { recursive: true })
  await extractZip(archive, { dir: destination })
}

/**
 * Include app-local Windows DLLs when Python creates a virtual environment.
 * @param source - Pinned Python standard-library venv module.
 * @returns Module copying the same compatibility DLLs beside each virtual-environment launcher.
 */
export function win7PythonVenv(source: string): string {
  const normalized = source.replace(/\r\n/gu, '\n')
  const anchor = '            do_copies = True\n            if self.symlinks:'
  if (normalized.split(anchor).length !== 2) throw new Error('Win7 Python source does not match the pinned venv module')
  return normalized.replace(anchor, `            runtime_dlls = {
                name: os.path.join(dirname, name) for name in os.listdir(dirname)
                if name.lower().endswith('.dll')
                and name.lower().startswith(('api-ms-', 'vcruntime', 'ucrtbase'))
            }
            copy_sources.update(runtime_dlls)
            link_sources.update(runtime_dlls)
${anchor}`)
}

/**
 * Install the Win7 interpreters and Python libraries compiled for their Python ABI.
 * @param root - Prepared primary-runtime directory.
 * @param electron - Extracted patched Electron directory.
 * @param cache - Verified download cache.
 * @returns Resolves after publishing matching runtime metadata.
 */
export async function prepareWin7PrimaryRuntime(root: string, electron: string, cache: string): Promise<void> {
  const manifestPath = join(root, 'runtime.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { python: string; node: string; payloadDigest: string }
  const python = join(root, 'dependencies', 'python')
  const archive = await downloadPrimaryRuntimeAsset(lock.python.url, lock.python.sha256, cache)
  rmSync(python, { recursive: true, force: true })
  const staging = mkdtempSync(join(tmpdir(), 'dsh-w7-python-'))
  try {
    await extractZip(archive, { dir: staging })
    cpSync(join(staging, 'tools'), python, { recursive: true })
  } finally { rmSync(staging, { recursive: true, force: true }) }
  const sitePackages = join(python, 'Lib', 'site-packages')
  mkdirSync(sitePackages, { recursive: true })
  for (const wheel of [...primaryLock.wheels, ...lock.python.wheels]) {
    await unpackPrimaryRuntimeWheel(await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, cache), sitePackages)
  }
  prunePrimaryRuntimePythonTests(sitePackages)
  const node = join(root, 'dependencies', 'node', 'bin')
  rmSync(node, { recursive: true, force: true })
  cpSync(electron, node, { recursive: true })
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(import.meta.dirname, 'prepare-win7-node.ps1'),
    '-OutputDirectory', node], { stdio: 'inherit', windowsHide: true })
  for (const name of ['node.obj', 'compile-node.cmd']) rmSync(join(node, name), { force: true })
  const ucrt = process.env.DSH_DESKTOP_WIN7_UCRT_DIR ?? join(process.env['ProgramFiles(x86)'] ?? '',
    'Windows Kits', '10', 'Redist', lock.ucrt.sdk, 'ucrt', 'DLLs', 'x64')
  const dlls = readdirSync(ucrt).filter(name => name.endsWith('.dll')).sort()
  const digest = createHash('sha256')
  for (const name of dlls) digest.update(name).update('\0').update(readFileSync(join(ucrt, name)))
  if (digest.digest('hex') !== lock.ucrt.sha256) throw new Error(`Win7 UCRT checksum mismatch: ${ucrt}`)
  const shared = join(root, '..', 'win7-ucrt')
  mkdirSync(shared, { recursive: true })
  for (const name of dlls) for (const destination of [python, node, shared]) copyFileSync(join(ucrt, name), join(destination, name))
  const venv = join(python, 'Lib', 'venv', '__init__.py')
  writeFileSync(venv, win7PythonVenv(readFileSync(venv, 'utf8')))
  manifest.node = lock.electron.node
  manifest.python = lock.python.version
  manifest.payloadDigest = createHash('sha256').update(JSON.stringify({ original: manifest.payloadDigest, lock, venv: win7PythonVenv.toString(), launcher: readFileSync(join(import.meta.dirname, 'win7-node.c'), 'utf8') })).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
}
