/** Build the pinned internal-module accessor with an explicit Electron 44.2 runtime profile. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { x as extractTar } from 'tar'
import extractZip from 'extract-zip'
import { downloadPrimaryRuntimeAsset, downloadRuntimeNpmPackage } from '../../../scripts/primary-runtime/prepare.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import lock from './win7-runtime-lock.json' with { type: 'json' }

/**
 * Add the pinned runtime fingerprint without changing native pointer or symbol validation.
 * @param source - Pinned upstream profile table.
 * @returns Profile table including Electron 44.2.0.
 */
export function win7RuntimeProfile(source: string): string {
  const count = 'std::array<ElectronProfileSpec, 4>'
  const row = '    {"44.7.0", 24, 21, 0, "15.2.124.28-electron.0",'
  if (source.split(count).length !== 2 || source.split(row).length !== 2) throw new Error('Win7 native source does not match the pinned profile table')
  return source.replace(count, 'std::array<ElectronProfileSpec, 5>').replace(row,
    `    {"44.2.0", 24, 20, 0, "15.2.124.19-electron.0",\n     "electron-44.2 tagged default=0"},\n${row}`)
}

/**
 * Compile and install the Win7 runtime accessor before sealing production dependency bytes.
 * @param runtime - Materialized dsh dependency tree.
 * @param build - Target-owned build directory.
 * @param cache - Verified archive cache.
 * @returns Resolves after the replacement binary is installed.
 */
export async function installWin7NativeBinding(runtime: string, build: string, cache: string): Promise<void> {
  const output = join(build, 'win7-native')
  mkdirSync(output, { recursive: true })
  const binary = join(output, 'require_builtin.node')
  const identity = createHash('sha256').update(JSON.stringify(lock.builtin)).update(win7RuntimeProfile.toString()).digest('hex')
  const marker = join(output, 'build.json')
  let reusable = false
  if (existsSync(marker) && existsSync(binary)) {
    const record = JSON.parse(readFileSync(marker, 'utf8')) as { identity: string; sha256: string }
    reusable = record.identity === identity && record.sha256 === createHash('sha256').update(readFileSync(binary)).digest('hex')
  }
  if (!reusable) {
    const source = mkdtempSync(join(tmpdir(), 'dsh-w7-'))
    try {
      await extractTar({ file: await downloadPrimaryRuntimeAsset(lock.builtin.url, lock.builtin.sha256, cache), cwd: source, strip: 1 })
      const profile = join(source, 'packages', 'native', 'src', 'runtime_context', 'runtime_profile.cc')
      writeFileSync(profile, win7RuntimeProfile(readFileSync(profile, 'utf8')))
      const gyp = join(source, 'packages', 'native', 'binding.gyp')
      const spec = JSON.parse(readFileSync(gyp, 'utf8')) as { targets: { msvs_settings?: object }[] }
      spec.targets[0]!.msvs_settings = { VCCLCompilerTool: { RuntimeLibrary: 0 } }
      writeFileSync(gyp, `${JSON.stringify(spec, undefined, 2)}\n`)
      const invocation = pnpmInvocation([])
      const options = { cwd: source, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, COREPACK_ROOT: undefined, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', NARB_BACKEND: 'napi', NARB_PRODUCT: 'require-builtin', NARB_BUILD_OUTPUT: 'prebuild' } } as const
      execFileSync(invocation.command, [...invocation.args, 'install', '--frozen-lockfile', '--ignore-scripts'], options)
      execFileSync(invocation.command, [...invocation.args, 'exec', 'tsx', 'scripts/build.ts'], options)
      copyFileSync(join(source, 'packages', 'require-builtin', 'win32-x64-msvc', 'prebuilt', 'win32-x64-msvc-napi-v9.node'), binary)
      writeFileSync(marker, `${JSON.stringify({ identity, sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), upstream: lock.builtin }, undefined, 2)}\n`)
    } finally { rmSync(source, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  }
  const destination = join(runtime, 'node_modules', 'node-addon-require-builtin-win32-x64-msvc', 'prebuilt', 'win32-x64-msvc-napi-v9.node')
  if (!existsSync(destination)) throw new Error(`Win7 native dependency is absent: ${destination}`)
  copyFileSync(binary, destination)
}

/**
 * Select the existing WebAssembly Office engine in a Win7-only dependency copy.
 * @param source - Published LibreOfficeKit resolver bundle.
 * @returns Resolver selecting its verified WebAssembly engine.
 */
export function win7OfficeEngine(source: string): string {
  const signature = 'async function resolveEngine(resolvePackage = (name) => require.resolve(`${name}/package.json`), packageExists = installedPackageExists, { platform = process.platform, arch = process.arch, report = hostReport } = {}) {'
  if (source.split(signature).length !== 2 || source.includes(`${signature}\n\treturn`)) throw new Error('Win7 Office source does not match the pinned engine resolver')
  return source.replace(signature, `${signature}\n\treturn readEngine(resolvePackage(\`${'${ENGINE_PREFIX}'}-wasm\`), "wasm", "wasm");`)
}

/**
 * Install locked WebAssembly image/Office engines and a Windows 7 compatible search executable.
 * @param runtime - Materialized dsh dependency tree.
 * @param cache - Verified archive cache.
 * @returns Resolves after the compatibility dependencies have been installed and selected.
 */
export async function installWin7Dependencies(runtime: string, cache: string): Promise<void> {
  const modules = join(runtime, 'node_modules')
  for (const artifact of lock.wasmPackages) {
    const destination = join(modules, artifact.name)
    rmSync(destination, { recursive: true, force: true })
    await downloadRuntimeNpmPackage(artifact, destination, cache)
  }
  // Sharp's published loader selects its official WASM package when no platform binary is installed.
  for (const name of ['sharp-win32-x64', 'sharp-libvips-win32-x64']) rmSync(join(modules, '@img', name), { recursive: true, force: true })
  const office = join(modules, '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')
  writeFileSync(office, win7OfficeEngine(readFileSync(office, 'utf8')))
  const staging = mkdtempSync(join(tmpdir(), 'dsh-w7-rg-'))
  try {
    await extractZip(await downloadPrimaryRuntimeAsset(lock.ripgrep.url, lock.ripgrep.sha256, cache), { dir: staging })
    copyFileSync(join(staging, `ripgrep-${lock.ripgrep.version}-x86_64-pc-windows-msvc`, 'rg.exe'),
      join(modules, '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe'))
  } finally { rmSync(staging, { recursive: true, force: true }) }
}
