import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'

const releasesUrl =
  'https://api.github.com/repos/nickpio/umbrel-zcash/releases?per_page=100&page=1'
const tokenUrl =
  'https://ghcr.io/token?service=ghcr.io&scope=repository:nickpio/umbrel-zcash:pull'
const manifestUrl = 'https://ghcr.io/v2/nickpio/umbrel-zcash/manifests/v0.1.18'
const manifest = JSON.stringify({
  manifests: [{platform: {os: 'linux', architecture: 'amd64'}}],
})
const digest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`
const release = {
  tag_name: 'v0.1.18',
  draft: false,
  prerelease: false,
  name: 'Zcash Node 0.1.18',
  body: 'New node versions.\n\n## Notes\nSafe: YAML # text',
  html_url: 'https://github.com/nickpio/umbrel-zcash/releases/tag/v0.1.18',
}

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'umbrel-store-sync-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  await cp(
    new URL('../personal-zcash-node', import.meta.url),
    path.join(root, 'personal-zcash-node'),
    {recursive: true},
  )
  // Freeze the starting version; this store's checked-in listing will advance.
  const appPath = path.join(root, 'personal-zcash-node/umbrel-app.yml')
  const composePath = path.join(root, 'personal-zcash-node/docker-compose.yml')
  await writeFile(
    appPath,
    (await readFile(appPath, 'utf8'))
      .replace(/^version: .*$/m, 'version: "0.1.17"')
      .replace(/^(icon: .*\?v=)[\d.]+$/m, (_, prefix) => `${prefix}0.1.17`),
  )
  await writeFile(
    composePath,
    (await readFile(composePath, 'utf8')).replace(
      /umbrel-zcash:\S+/,
      `umbrel-zcash:v0.1.17@sha256:${'0'.repeat(64)}`,
    ),
  )
  const responses = {
    [releasesUrl]: {body: JSON.stringify([release])},
    [tokenUrl]: {body: JSON.stringify({token: 'test-registry-token'})},
    [manifestUrl]: {body: manifest, headers: {'docker-content-digest': digest}},
    ...overrides,
  }
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(String(url))
    const response = responses[url]
    assert.ok(response, `unexpected fetch: ${url}`)
    return new Response(response.body ?? '', {
      status: response.status ?? 200,
      headers: response.headers,
    })
  }
  const read = (name) =>
    readFile(path.join(root, 'personal-zcash-node', name), 'utf8')
  const before = {
    app: await read('umbrel-app.yml'),
    compose: await read('docker-compose.yml'),
  }
  return {root, fetchImpl, requests, read, before}
}

async function sync(f, options = {}) {
  const {syncRelease} = await import('./sync-zcash-release.mjs')
  return syncRelease({root: f.root, fetchImpl: f.fetchImpl, ...options})
}

test('updates the app listing to a stable release with its verified registry digest', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await sync(f), {
    changed: true,
    version: '0.1.18',
    image: `ghcr.io/nickpio/umbrel-zcash:v0.1.18@${digest}`,
  })
  const app = await f.read('umbrel-app.yml')
  assert.match(app, /^version: "0\.1\.18"$/m)
  assert.match(app, /icon: .*\?v=0\.1\.18\n/)
  assert.ok(app.includes('  Safe: YAML # text\n'))
  assert.ok(app.includes(release.html_url))
  const compose = await f.read('docker-compose.yml')
  assert.ok(
    compose.includes(`image: ghcr.io/nickpio/umbrel-zcash:v0.1.18@${digest}`),
  )
  assert.equal(
    compose.replace(/umbrel-zcash:v\S+/, 'umbrel-zcash:IMAGE'),
    f.before.compose.replace(/umbrel-zcash:v\S+/, 'umbrel-zcash:IMAGE'),
  )
  assert.deepEqual(f.requests, [releasesUrl, tokenUrl, manifestUrl])
})

test('never downgrades the store or refreshes an already distributed version', async (t) => {
  for (const tag_name of ['v0.1.15', 'v0.1.17']) {
    const f = await fixture(t, {
      [releasesUrl]: {body: JSON.stringify([{...release, tag_name}])},
    })
    assert.deepEqual(await sync(f), {changed: false, version: '0.1.17'})
    assert.deepEqual(f.requests, [releasesUrl])
    assert.equal(await f.read('umbrel-app.yml'), f.before.app)
    assert.equal(await f.read('docker-compose.yml'), f.before.compose)
  }
})

test('finds the highest stable semver across pages, ignoring drafts and release candidates', async (t) => {
  const invalid = [
    {...release, tag_name: 'v99.0.0', draft: true},
    {...release, tag_name: 'v98.0.0', prerelease: true},
    {...release, tag_name: 'v97.0.0-rc.1'},
  ]
  const secondPage = releasesUrl.replace('&page=1', '&page=2')
  const f = await fixture(t, {
    [releasesUrl]: {
      body: JSON.stringify(
        Array.from({length: 100}, (_, i) => invalid[i % invalid.length]),
      ),
    },
    [secondPage]: {
      body: JSON.stringify([
        {...release, tag_name: 'v0.1.9'},
        release,
        {...release, tag_name: 'v0.1.17'},
      ]),
    },
  })
  assert.equal((await sync(f)).version, '0.1.18')
  assert.deepEqual(f.requests, [releasesUrl, secondPage, tokenUrl, manifestUrl])
})

test('ignores release versions with leading-zero components', async (t) => {
  for (const tag_name of [
    'v01.0.0',
    'v0.02.0',
    'v0.1.019',
    '01.0.0',
    '0.02.0',
    '0.1.019',
  ]) {
    const f = await fixture(t, {
      [releasesUrl]: {
        body: JSON.stringify([{...release, tag_name}, release]),
      },
    })
    assert.equal((await sync(f)).version, '0.1.18')
    assert.deepEqual(f.requests, [releasesUrl, tokenUrl, manifestUrl])
  }
})

test('selects adjacent versions beyond Number precision exactly', async (t) => {
  for (const [lower, higher] of [
    ['9007199254740992.0.0', '9007199254740993.0.0'],
    ['0.9007199254740992.0', '0.9007199254740993.0'],
    ['0.1.9007199254740992', '0.1.9007199254740993'],
  ]) {
    await t.test(higher, async (t) => {
      const url = (version) =>
        `https://ghcr.io/v2/nickpio/umbrel-zcash/manifests/v${version}`
      const response = {
        body: manifest,
        headers: {'docker-content-digest': digest},
      }
      const f = await fixture(t, {
        [releasesUrl]: {
          body: JSON.stringify([
            {...release, tag_name: `v${lower}`},
            {...release, tag_name: `v${higher}`},
          ]),
        },
        [url(lower)]: response,
        [url(higher)]: response,
      })
      assert.deepEqual(await sync(f), {
        changed: true,
        version: higher,
        image: `ghcr.io/nickpio/umbrel-zcash:v${higher}@${digest}`,
      })
      assert.deepEqual(f.requests, [releasesUrl, tokenUrl, url(higher)])
    })
  }
})

test('refuses an image without linux amd64 support and leaves both files unchanged', async (t) => {
  const body = JSON.stringify({
    manifests: [{platform: {os: 'linux', architecture: 'arm64'}}],
  })
  const f = await fixture(t, {
    [manifestUrl]: {
      body,
      headers: {
        'docker-content-digest': `sha256:${createHash('sha256').update(body).digest('hex')}`,
      },
    },
  })
  await assert.rejects(sync(f), /linux\/amd64/)
  assert.equal(await f.read('umbrel-app.yml'), f.before.app)
  assert.equal(await f.read('docker-compose.yml'), f.before.compose)
})

test('does not modify the store when the release or image cannot be verified', async (t) => {
  const cases = [
    {[releasesUrl]: {status: 503}},
    {[releasesUrl]: {body: '[]'}},
    {[tokenUrl]: {status: 403}},
    {[manifestUrl]: {status: 404}},
    {
      [manifestUrl]: {
        body: manifest,
        headers: {'docker-content-digest': `sha256:${'0'.repeat(64)}`},
      },
    },
  ]
  for (const responses of cases) {
    const f = await fixture(t, responses)
    await assert.rejects(sync(f))
    assert.equal(await f.read('umbrel-app.yml'), f.before.app)
    assert.equal(await f.read('docker-compose.yml'), f.before.compose)
  }
})

test('dry run verifies a newer image without modifying either listing file', async (t) => {
  const f = await fixture(t)
  assert.equal((await sync(f, {dryRun: true})).version, '0.1.18')
  assert.equal(await f.read('umbrel-app.yml'), f.before.app)
  assert.equal(await f.read('docker-compose.yml'), f.before.compose)
})

test('a second sync after distributing the release is a no-op', async (t) => {
  const f = await fixture(t)
  await sync(f)
  f.requests.length = 0
  assert.deepEqual(await sync(f), {changed: false, version: '0.1.18'})
  assert.deepEqual(f.requests, [releasesUrl])
})
