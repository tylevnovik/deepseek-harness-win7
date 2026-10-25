/** Windows console API selection; ConPTY requires Windows 10 build 18309 or later. */

/**
 * Select WinPTY when the OS predates the console API used by node-pty.
 * @param osRelease - Windows kernel version returned by node:os.
 * @returns Whether terminal allocation requires the WinPTY provider.
 */
export function requiresWinpty(osRelease: string): boolean {
  const [major, , build] = osRelease.split('.').map(Number)
  return major !== undefined && (major < 10 || (major === 10 && build !== undefined && build < 18309))
}
