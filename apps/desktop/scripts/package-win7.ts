/** Assemble a separate Windows 7 portable application using the normal dsh production package tree. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import lock from './win7-runtime-lock.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '../../..')
const APP = join(ROOT, 'apps', 'desktop')

async function run(args: string[], environment: NodeJS.ProcessEnv, cwd = ROOT): Promise<void> {
  const invocation = pnpmInvocation(args)
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd, env: environment, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolveRun() : reject(new Error(`Win7 build: pnpm ${args.join(' ')} exited ${String(code)}`)))
  })
}

async function main(): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Win7 portable builds require Windows x64')
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'skip-build': { type: 'boolean' }, 'skip-prepare': { type: 'boolean' } } })
  const environment = { ...process.env, DSH_DESKTOP_WIN7: '1', DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64' }
  const paths = desktopTargetBuildPaths('win-x64', environment)
  const output = resolve(values.out ?? join(paths.root, `portable-${new Date().toISOString().replace(/[-:.]/gu, '')}`))
  await mkdir(output, { recursive: false })
  const record = { format: 1, status: 'preparing', target: 'win7-sp1-x64', runtime: lock, guestValidation: 'not-run' }
  await writeFile(join(output, 'win7-build.json'), `${JSON.stringify(record, undefined, 2)}\n`)
  if (!values['skip-build']) await run(['run', 'build:artifacts', '--profile', 'local'], environment)
  if (!values['skip-prepare']) {
    await run(['exec', 'tsx', 'apps/desktop/scripts/pack-local-packages.ts', '--out', paths.packedDsh, '--concurrency', '8'], environment)
    await run(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', paths.packedDsh], environment)
    await run(['run', 'release:pack', '--family', 'vendor', '--out', paths.packedVendor, '--concurrency', '8'], environment)
    await run(['--dir', 'native/system', 'run', 'build:ts'], environment)
    await run(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', paths.packedLandlock], environment)
    await run(['--dir', 'apps/desktop', 'run', 'prepare:runtime'], environment)
    await run(['--dir', 'apps/desktop', 'run', 'prepare:packages'], environment)
    await run(['--dir', 'apps/desktop', 'run', 'prepare:dsh', '--defer-runtime-smoke'], environment)
  }
  await stat(join(paths.dsh, 'desktop-runtime.json'))
  await run(['exec', 'electron-builder', '--win', 'dir', '--x64', '--config', 'scripts/electron-builder-win7.config.mjs'],
    { ...environment, DSH_DESKTOP_WIN7_OUTPUT: output }, APP)
  const unpacked = join(output, 'win-unpacked')
  for (const name of await readdir(unpacked)) await rename(join(unpacked, name), join(output, name))
  await rmdir(unpacked)
  const app = join(output, 'resources', 'app')
  const manifest = JSON.parse(await readFile(join(APP, 'package.json'), 'utf8')) as Record<string, unknown>
  await cp(join(ROOT, 'LICENSE'), join(output, 'LICENSE'))
  const runtimeDescriptor = await readFile(join(app, 'dsh', 'desktop-runtime.json'))
  await writeFile(join(output, 'win7-build.json'), `${JSON.stringify({ ...record, status: 'built', version: manifest.version,
    descriptorSha256: createHash('sha256').update(runtimeDescriptor).digest('hex') }, undefined, 2)}\n`)
  console.log(`WIN7_PORTABLE ${output}`)
}

await main()
