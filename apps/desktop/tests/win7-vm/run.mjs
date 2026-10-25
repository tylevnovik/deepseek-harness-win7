/** Validate Harness in the existing owned Win7 guest through ZCode's controller and CDP transport. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'))
const { createController } = await import(pathToFileURL(join(config.referenceRoot, 'tools/win7-vm/controller.mjs')).href)
const { server, queue, getHeartbeat } = createController(config.token)
const headers = { Authorization: `Bearer ${config.token}` }
const results = []
let browser
let page
async function waitFor(check, label, timeout = 90000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await delay(350)
  }
  throw new Error(`${label}: deadline exceeded`)
}
async function job(action, params = {}) {
  const entry = queue.submit(action, params)
  await waitFor(() => entry.state === 'completed', action, 240000)
  if (!entry.result.ok) throw new Error(`${action}: ${entry.result.error}`)
  return entry.result.value
}
async function check(name, action) {
  try { results.push({ name, passed: true, value: await action() }); console.log(`${name}: passed`) }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.error(`${name}: ${error.message}`) }
  await writeFile(join(config.runRoot, 'report.json'), JSON.stringify({ heartbeat: getHeartbeat(), results }, undefined, 2))
}
await new Promise((ready, reject) => { server.once('error', reject); server.listen(config.port, config.hostIp, ready) })
await writeFile(join(config.runRoot, 'host-ready'), 'ready\n')
try {
  await waitFor(getHeartbeat, 'Win7 heartbeat', 600000)
  await check('guest-runtime', async () => {
    const value = await job('runtime')
    assert.match(value.release, /^6\.1\./u)
    assert.equal(value.versions.electron, '44.2.0')
    assert.equal(value.versions.node, '24.20.0')
    assert.equal(value.sqlite, 'Win7-中文')
    return value
  })
  await check('packaged-dependencies', async () => {
    const value = await job('diagnostics')
    const diagnostics = value.report
    await writeFile(join(config.runRoot, 'dependency-report.json'), JSON.stringify(diagnostics, undefined, 2))
    assert.equal(diagnostics.checks.length, 12, JSON.stringify(diagnostics))
    assert(diagnostics.checks.every(check => check.passed), JSON.stringify(diagnostics))
    assert.equal(diagnostics.active, undefined)
    assert(!value.failed, value.error)
    return diagnostics
  })
  await check('desktop-ui', async () => {
    await job('launch', { profile: 'desktop' })
    const endpoint = `http://${config.guestIp}:${config.proxyPort}`
    await waitFor(async () => {
      try { return (await fetch(`${endpoint}/json/version`, { headers, signal: AbortSignal.timeout(1500) })).ok }
      catch (_notReady) { return false }
    }, 'Desktop CDP')
    const { chromium } = createRequire(join(config.referenceRoot, 'packages/desktop/package.json'))('playwright-core')
    browser = await chromium.connectOverCDP(endpoint, { headers })
    page = await waitFor(() => browser.contexts().flatMap(context => context.pages()).find(candidate => !candidate.url().startsWith('devtools:')), 'Desktop page')
    await page.locator('body').waitFor()
    await waitFor(async () => (await page.locator('body').innerText()).trim(), 'Desktop content')
    await page.screenshot({ path: join(config.runRoot, 'desktop.png') })
    const api = page.getByRole('button', { name: /使用 API key|Use API key/iu })
    if (await api.isVisible()) {
      await api.click()
      await page.getByRole('button', { name: /稍后配置|Set up later/iu }).click()
      page = await waitFor(() => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('dsh-app:')), 'Workspace page')
      await waitFor(async () => (await page.locator('body').innerText()).trim(), 'Workspace content')
      await page.screenshot({ path: join(config.runRoot, 'workspace.png') })
    }
    await waitFor(async () => (await page.locator('[data-dsh-boot]').count()) === 0, 'Client plugins ready', 180000)
    await page.screenshot({ path: join(config.runRoot, 'workspace.png') })
    const text = await page.locator('body').innerText()
    await writeFile(join(config.runRoot, 'desktop-dom.txt'), text)
    return { url: page.url(), title: await page.title(), text: text.slice(0, 4000) }
  })
} finally {
  if (browser) await browser.close()
  if (getHeartbeat()) {
    try {
      await writeFile(join(config.runRoot, 'guest-logs.json'), JSON.stringify(await job('collect'), undefined, 2))
      await job('stop')
      await job('shutdown')
    } catch (error) { results.push({ name: 'teardown', passed: false, error: error.stack }) }
  }
  await writeFile(join(config.runRoot, 'report.json'), JSON.stringify({ heartbeat: getHeartbeat(), results }, undefined, 2))
  await writeFile(join(config.runRoot, 'stop-vm'), 'stop\n')
  await new Promise(resolveClose => server.close(resolveClose))
  if (results.some(result => !result.passed)) process.exitCode = 1
  else if (results.length === 3) {
    const path = join(config.artifactRoot, 'win7-build.json')
    const build = JSON.parse(await readFile(path, 'utf8'))
    const descriptor = await readFile(join(config.artifactRoot, 'resources/app/dsh/desktop-runtime.json'))
    assert.equal(createHash('sha256').update(descriptor).digest('hex'), build.descriptorSha256)
    const report = await readFile(join(config.runRoot, 'report.json'))
    await writeFile(join(config.artifactRoot, 'win7-validation.json'), report)
    build.guestValidation = { status: 'passed', runId: config.runId, reportSha256: createHash('sha256').update(report).digest('hex') }
    await writeFile(path, `${JSON.stringify(build, undefined, 2)}\n`)
  }
}
