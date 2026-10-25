/** Compatibility target isolation and fail-closed native profile editing. */
import { describe, expect, it } from 'vitest'
import { desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'
import { win7RuntimeProfile, win7OfficeEngine } from '../scripts/prepare-win7-native.ts'
import { win7PythonVenv } from '../scripts/prepare-win7-runtime.ts'

describe('Windows 7 preparation', () => {
  it('keeps compatibility outputs separate from ordinary Windows outputs', () => {
    const normal = desktopTargetBuildPaths('win-x64', {})
    const win7 = desktopTargetBuildPaths('win-x64', { DSH_DESKTOP_WIN7: '1' })
    expect(win7.root).not.toBe(normal.root)
    expect(win7.dsh).not.toBe(normal.dsh)
    expect(win7.downloads).toBe(normal.downloads)
    expect(() => desktopTargetBuildPaths('mac-x64', { DSH_DESKTOP_WIN7: '1' })).toThrow('win-x64')
    expect(() => desktopTargetBuildPaths('win-x64', { DSH_DESKTOP_WIN7: 'yes' })).toThrow('0 or 1')
  })
  it('only adds the pinned Electron profile to the expected upstream table', () => {
    const source = 'std::array<ElectronProfileSpec, 4>\n    {"44.7.0", 24, 21, 0, "15.2.124.28-electron.0",'
    const patched = win7RuntimeProfile(source)
    expect(patched).toContain('std::array<ElectronProfileSpec, 5>')
    expect(patched).toContain('"44.2.0", 24, 20, 0, "15.2.124.19-electron.0"')
    expect(patched).toContain('"44.7.0", 24, 21, 0, "15.2.124.28-electron.0"')
    expect(() => win7RuntimeProfile('unrecognized source')).toThrow('pinned profile table')
    expect(() => win7RuntimeProfile(`${source}\n${source}`)).toThrow('pinned profile table')
  })
  it('rejects an unknown or already edited Office engine resolver', () => {
    expect(() => win7OfficeEngine('unrecognized source')).toThrow('pinned engine resolver')
    const signature = 'async function resolveEngine(resolvePackage = (name) => require.resolve(`${name}/package.json`), packageExists = installedPackageExists, { platform = process.platform, arch = process.arch, report = hostReport } = {}) {'
    expect(win7OfficeEngine(signature)).toContain('return readEngine(resolvePackage(`${ENGINE_PREFIX}-wasm`), "wasm", "wasm");')
    expect(() => win7OfficeEngine(win7OfficeEngine(signature))).toThrow('pinned engine resolver')
    expect(() => win7OfficeEngine(`${signature}\n${signature}`)).toThrow('pinned engine resolver')
  })
  it('requires the pinned venv copy and symlink selection before adding runtime DLLs', () => {
    const source = '            do_copies = True\n            if self.symlinks:'
    expect(win7PythonVenv(source)).toContain('copy_sources.update(runtime_dlls)')
    expect(win7PythonVenv(source)).toContain('link_sources.update(runtime_dlls)')
    expect(() => win7PythonVenv('unrecognized source')).toThrow('pinned venv module')
    expect(() => win7PythonVenv(`${source}\n${source}`)).toThrow('pinned venv module')
  })
})
