/** WinPTY natural exit must release its output worker and let the owning Node process drain. */
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'win32')('exits after a WinPTY shell closes naturally', async () => {
  const require = createRequire(new URL('../../../packages/subprocess/subprocess-local/package.json', import.meta.url))
  const entry = require.resolve('node-pty-win7')
  const script = `
    const pty = require(process.argv[1]);
    const terminal = pty.spawn(process.env.ComSpec, ['/d', '/c', 'echo WINPTY_EXIT_OK'], {
      cwd: process.cwd(), env: process.env, cols: 80, rows: 24, useConpty: false
    });
    terminal.onData(text => process.stdout.write(text));
    terminal.onExit(event => { if (event.exitCode !== 0) process.exitCode = 1; });
  `
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', script, entry], {
    timeout: 30_000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' },
  })
  expect(stdout).toContain('WINPTY_EXIT_OK')
})
