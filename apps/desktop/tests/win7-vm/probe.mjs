/** Actual packaged dependency checks, run only inside an isolated validation profile. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

const [appRoot, profile] = process.argv.slice(2)
const runtime = join(appRoot, 'resources/app/dsh')
const requireRuntime = createRequire(join(runtime, 'package.json'))
const executeFile = promisify(execFile)
const checks = []
async function check(name, action) {
  const started = Date.now()
  await writeFile(join(profile, 'probe-report.json'), JSON.stringify({ active: name, checks }, undefined, 2))
  try { checks.push({ name, passed: true, value: await action(), milliseconds: Date.now() - started }) }
  catch (error) { checks.push({ name, passed: false, error: error.stack, milliseconds: Date.now() - started }) }
  await writeFile(join(profile, 'probe-report.json'), JSON.stringify({ checks }, undefined, 2))
}
await check('internal-module-access', async () => {
  assert.equal(typeof requireRuntime('node-addon-require-builtin').requireBuiltin('internal/modules/esm/loader').getOrInitializeCascadedLoader, 'function')
})
await check('koffi', async () => {
  const kernel = requireRuntime('koffi').load('kernel32.dll')
  assert.equal(kernel.func('uint32_t __stdcall GetCurrentProcessId()')(), process.pid)
  // Missing dependency errors must return to the isolated runner instead of opening a system dialog.
  kernel.func('uint32_t __stdcall SetErrorMode(uint32_t)')(0x8003)
})
await check('sharp', async () => {
  const image = await requireRuntime('sharp')({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  assert.equal((await requireRuntime('sharp')(image).metadata()).width, 2)
})
await check('python', async () => {
  const root = join(appRoot, 'resources/runtime/primary-runtime')
  const python = join(root, 'dependencies/python/python.exe')
  const manifest = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'))
  const { stdout } = await executeFile(python,
    ['-I', '-B', '-c', 'import sys,ssl,sqlite3,numpy,pandas,PIL,lxml.etree,docx,pptx,openpyxl; assert numpy.arange(4).sum()==6; print(sys.version)'],
    { timeout: 60000, windowsHide: true })
  assert(stdout.startsWith('3.14.5'), stdout)
  await executeFile(python, ['-I', '-B', join(import.meta.dirname, 'python-smoke.py'), JSON.stringify(manifest.pythonPackages), manifest.python],
    { timeout: 90000, windowsHide: true })
  return stdout.trim()
})
await check('standalone-node', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await executeFile(join(appRoot, 'resources/runtime/primary-runtime/dependencies/node/bin/node.exe'),
    ['-p', 'JSON.stringify(process.versions)'], { env, timeout: 30000, windowsHide: true })
  assert.equal(JSON.parse(stdout).node, '24.20.0')
})
await check('winpty', async () => {
  const pty = requireRuntime('node-pty-win7')
  await new Promise((resolveDone, reject) => {
    const terminal = pty.spawn(process.env.ComSpec, ['/d', '/c', 'echo DSH_WIN7_PTY'], { cwd: profile, env: process.env, cols: 80, rows: 24, useConpty: false })
    let output = ''
    const timer = setTimeout(() => { terminal.kill(); reject(new Error(`PTY timeout: ${output}`)) }, 30000)
    terminal.onData(text => { output += text })
    terminal.onExit(event => { clearTimeout(timer); event.exitCode === 0 && output.includes('DSH_WIN7_PTY') ? resolveDone() : reject(new Error(`PTY ${event.exitCode}: ${output}`)) })
  })
})
await check('managed-process-and-terminal', async () => {
  const { Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href)
  const { default: LocalRuntime } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-subprocess-local')).href)
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalRuntime)
  try {
    const handle = await ctx.subprocess.spawn({ argv: [process.env.ComSpec, '/d', '/c', 'echo DSH_MANAGED_OK'], cwd: profile,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 64000 }, stderr: { maxBytes: 64000 } }, graceMs: 1000 })
    try {
      assert.equal((await handle.done).exitCode, 0)
      assert(handle.collected.stdout.readFrom(0).text.includes('DSH_MANAGED_OK'))
    } finally { await handle.terminate(); await handle.waitForExit() }
    const terminal = await ctx.subprocess.spawnTerminal({ argv: [process.env.ComSpec, '/d', '/c', 'echo DSH_TERMINAL_OK'], cwd: profile,
      rows: 24, cols: 80, terminalType: 'xterm-256color', graceMs: 1000 })
    let output = ''
    terminal.output.on('data', chunk => { output += chunk.toString() })
    try { assert.equal((await terminal.done).exitCode, 0); assert(output.includes('DSH_TERMINAL_OK')) }
    finally { await terminal.terminate() }
  } finally { await fiber.dispose() }
})
await check('powershell-utf8', async () => {
  const { Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href)
  const { default: LocalRuntime } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-subprocess-local')).href)
  const { PwshLocalExecutor } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-pwsh-local')).href)
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalRuntime)
  try {
    await ctx.plugin(PwshLocalExecutor)
    const result = await (await ctx.shell.execute(ctx.shell.resolve({ command: 'Write-Output "Win7-中文"', workdir: profile, timeoutMs: 30000 }))).result()
    assert.equal(result.exitCode, 0)
    assert(result.stdout.text.includes('Win7-中文'), result.stdout.text + result.stderr.text)
    assert.equal(result.stderr.text, '')
    return { output: result.stdout.text.trim() }
  } finally { await fiber.dispose() }
})
await check('office-to-pdf', async () => {
  const python = join(appRoot, 'resources/runtime/primary-runtime/dependencies/python/python.exe')
  const input = join(profile, 'input.docx')
  await executeFile(python, ['-I', '-B', '-c', 'from docx import Document; import sys; d=Document(); d.add_paragraph("Win7 Office validation"); d.save(sys.argv[1])', input], { timeout: 30000, windowsHide: true })
  const { createConverter } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/libreoffice-kit')).href)
  const converter = await createConverter({ timeoutMs: 60000, fontMetadataCacheDirectory: false })
  try {
    const output = join(profile, 'output.pdf')
    await converter.render({ inputPath: input, outputPath: output })
    assert.equal((await readFile(output)).subarray(0, 5).toString(), '%PDF-')
  } finally { await converter.dispose() }
})
await check('dsh-profile', async () => {
  const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  const { stdout } = await executeFile(process.execPath, ['--expose-internals', cli, '--profile', 'headless', '--dump-config'],
    { env: process.env, timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  assert(stdout.includes('headless-runner'))
})
await check('file-search', async () => {
  const { resolveRgPath } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-tool-fs-search')).href)
  const file = join(profile, 'grep-probe.txt')
  await writeFile(file, 'DSH_WIN7_SEARCH_OK\n')
  const { stdout } = await executeFile(await resolveRgPath(), ['--no-config', 'DSH_WIN7_SEARCH_OK', file], { windowsHide: true, timeout: 30000 })
  assert(stdout.includes('DSH_WIN7_SEARCH_OK'))
})
await check('actual-agent-turn', async () => {
  let requests = 0
  let recoveredHistory = false
  const server = createServer(async (request, response) => {
    if (request.url.endsWith('/count_tokens')) { response.setHeader('Content-Type', 'application/json'); response.end('{"input_tokens":64}'); return }
    if (request.method !== 'POST') { response.writeHead(404); response.end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests++
    if (body.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('DSH_WIN7_AGENT_OK'))) recoveredHistory = true
    const events = [
      { type: 'message_start', message: { id: 'win7-synthetic', model: body.model, usage: { input_tokens: 64, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'DSH_WIN7_AGENT_OK' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
      { type: 'message_stop' },
    ]
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready) })
  try {
    const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const options = { cwd: profile, env: { ...process.env, DEEPSEEK_API_KEY: 'sk-win7-synthetic-test-only',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}` }, timeout: 90000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
    const { stdout, stderr } = await executeFile(process.execPath,
      ['--expose-internals', cli, '--profile', 'headless', '--json', 'Reply with the validation marker.'],
      options)
    await writeFile(join(profile, 'headless-events.jsonl'), stdout)
    await writeFile(join(profile, 'headless-stderr.log'), stderr)
    assert(requests > 0)
    assert(stdout.includes('DSH_WIN7_AGENT_OK'), stdout.slice(-4000))
    const session = stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line)).find(event => event.type === 'session')
    assert(session?.sessionId, 'The first process must publish its Session id')
    const resumed = await executeFile(process.execPath,
      ['--expose-internals', cli, '--profile', 'headless', '--json', '--session-id', session.sessionId, 'Continue the saved conversation.'], options)
    await writeFile(join(profile, 'headless-resume-events.jsonl'), resumed.stdout)
    assert(resumed.stdout.includes('DSH_WIN7_AGENT_OK'), resumed.stdout.slice(-4000))
    assert(recoveredHistory, 'A fresh process must recover the prior assistant message from the saved Session')
    return { provider: 'loopback-synthetic', requests, recoveredHistory }
  } finally { await new Promise(resolveClose => server.close(resolveClose)) }
})
console.log(JSON.stringify({ checks }))
await writeFile(join(profile, 'active-resources.json'), JSON.stringify(process.getActiveResourcesInfo()))
