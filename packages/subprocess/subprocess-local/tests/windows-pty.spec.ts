/** Console API availability across Windows releases. */
import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { requiresWinpty } from '../src/windows-pty.ts'

describe('Windows terminal backend', () => {
  it.each(['6.1.7601', '6.2.9200', '6.3.9600', '10.0.17763'])('uses WinPTY on %s', (release) => {
    expect(requiresWinpty(release)).toBe(true)
  })
  it.each(['10.0.18309', '10.0.19045', '10.0.26100'])('uses ConPTY on %s', (release) => {
    expect(requiresWinpty(release)).toBe(false)
  })
  it('selects Windows terminal providers by the kernel version', async () => {
    const exitListeners: ((event: { exitCode: number; signal?: number }) => void)[] = []
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListeners.push(listener)
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    const nodePtySpawn = vi.fn((
      _file: string, _args: string[], _options: IPtyForkOptions | IWindowsPtyForkOptions,
    ) => terminal)
    const winptySpawn = vi.fn(nodePtySpawn.getMockImplementation())
    const inspector = {
      foregroundPgid: () => undefined,
      isStdinWaiting: () => false,
      snapshot: () => ({ tree: () => [], session: () => [], alive: () => false }),
      isAlive: () => false,
      signalGroup: () => {},
      signalProcess: () => {},
    }
    vi.resetModules()
    vi.doMock('@deepseek-ai/dsh-win32-process', () => ({
      loadWin32ProcessBindings: vi.fn(), probeCurrentTokenJobSupport: vi.fn(),
    }))
    vi.doMock('@deepseek-ai/dsh-lazy-require', () => ({
      createLazyRequire: (name: string) => () => {
        if (name === 'node-pty') return { spawn: nodePtySpawn }
        if (name === 'node-pty-win7') return { spawn: winptySpawn }
        throw new Error(`Unexpected lazy dependency: ${name}`)
      },
    }))
    vi.doMock('../src/process-inspector.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/process-inspector.ts')>(),
      createProcessInspector: () => inspector,
    }))
    let fiber: { dispose(): Promise<void> } | undefined
    const windowsRelease = vi.spyOn(os, 'release').mockReturnValue('10.0.19045')
    try {
      syncBuiltinESMExports()
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      const ctx = new Context()
      fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      const runtime = ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      runtime.terminalInspector = inspector
      const spawn = async (platform: NodeJS.Platform): Promise<SubprocessTerminalHandle> => {
        runtime.internals = { platform }
        return runtime.spawnTerminal({
          argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, terminalType: 'dumb', graceMs: 1,
        })
      }

      const windows = await spawn('win32')
      expect(nodePtySpawn).toHaveBeenLastCalledWith('shell', [], expect.objectContaining({ useConptyDll: true }))
      expect(winptySpawn).not.toHaveBeenCalled()
      windowsRelease.mockReturnValue('6.1.7601')
      const win7 = await spawn('win32')
      expect(winptySpawn).toHaveBeenLastCalledWith('shell', [], expect.objectContaining({ useConpty: false }))
      expect(winptySpawn.mock.calls.at(-1)?.[2]).not.toHaveProperty('useConptyDll')
      const posix = await spawn('darwin')
      expect(nodePtySpawn.mock.calls.at(-1)?.[2]).not.toHaveProperty('useConptyDll')

      for (const listener of exitListeners) listener({ exitCode: 0 })
      await Promise.all([windows.done, win7.done, posix.done])
    } finally {
      try { await fiber?.dispose() }
      finally {
        windowsRelease.mockRestore()
        syncBuiltinESMExports()
        vi.doUnmock('@deepseek-ai/dsh-lazy-require')
        vi.doUnmock('../src/process-inspector.ts')
        vi.doUnmock('@deepseek-ai/dsh-win32-process')
        vi.resetModules()
      }
    }
  })

})
