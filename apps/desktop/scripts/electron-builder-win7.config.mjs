/** Unsigned portable Windows 7 packaging without an ordinary Windows update feed. */
import { isAbsolute, join } from 'node:path'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

const output = process.env.DSH_DESKTOP_WIN7_OUTPUT
if (process.env.DSH_DESKTOP_WIN7 !== '1' || !output || !isAbsolute(output)) throw new Error('Win7 packaging requires an absolute DSH_DESKTOP_WIN7_OUTPUT')
const paths = desktopTargetBuildPaths('win-x64', process.env)
export default {
  appId: 'ai.deepseek.harness.win7',
  productName: 'DeepSeek Harness',
  directories: { output },
  electronDist: paths.electron,
  electronVersion: '44.2.0',
  electronFuses: { runAsNode: true },
  asar: false,
  publish: null,
  extraMetadata: { dshDesktopAppId: 'ai.deepseek.harness.win7', dshWindowsCompatibility: 'win7' },
  files: ['lib/main.js', 'lib/welcome/**/*', 'lib/preload-*.cjs', 'renderer/**/*', 'package.json',
    { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
    { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] }],
  extraResources: [{ from: paths.runtime, to: 'runtime' },
    { from: 'resources/icon-windows.png', to: 'icon.png' }, { from: 'resources/tray-windows.ico', to: 'tray.ico' }],
  extraFiles: [{ from: join(paths.runtime, 'win7-ucrt'), to: '.', filter: ['*.dll'] }],
  win: { executableName: 'DshHarness', signAndEditExecutable: false, target: ['dir'] },
}
