#!/usr/bin/env node
// Pull Zcash Node releases into this store; the app repository never writes here.
import {createHash} from 'node:crypto'
import {appendFile, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = 'nickpio/umbrel-zcash'
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function compareVersions(a, b) {
  const left = SEMVER.exec(a)?.slice(1).map(BigInt)
  const right = SEMVER.exec(b)?.slice(1).map(BigInt)
  if (!left || !right) throw new Error('Invalid app version')
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export async function syncRelease({
  root = ROOT,
  fetchImpl = fetch,
  dryRun = false,
  repo = REPO,
  imageRepo = repo,
  appId = 'personal-zcash-node',
  imageTag = (release) => release.tag_name,
  releaseSource = 'releases',
} = {}) {
  if (!['releases', 'tags'].includes(releaseSource))
    throw new Error('Unsupported release source')
  async function get(url, headers = {}) {
    const response = await fetchImpl(url, {
      headers: {'User-Agent': 'umbrel-app-store-release-sync', ...headers},
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`)
    return response
  }

  const githubHeaders = {Accept: 'application/vnd.github+json'}
  if (process.env.GITHUB_TOKEN)
    githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  let release
  for (let page = 1; ; page++) {
    const releases = await (
      await get(
        `https://api.github.com/repos/${repo}/${releaseSource}?per_page=100&page=${page}`,
        githubHeaders,
      )
    ).json()
    if (!Array.isArray(releases))
      throw new Error('Invalid GitHub releases response')
    for (const entry of releases) {
      const candidate = releaseSource === 'tags'
        ? {
            tag_name: entry.name,
            draft: false,
            prerelease: false,
            html_url: `https://github.com/${repo}/tree/${encodeURIComponent(entry.name)}`,
          }
        : entry
      if (
        candidate.draft !== false ||
        candidate.prerelease !== false ||
        typeof candidate.tag_name !== 'string' ||
        !SEMVER.test(candidate.tag_name)
      )
        continue
      if (!release || compareVersions(candidate.tag_name, release.tag_name) > 0)
        release = candidate
    }
    if (releases.length < 100) break
  }
  if (!release) throw new Error('No stable app release found')
  const version = release.tag_name.replace(/^v/, '')
  const appPath = path.join(root, appId, 'umbrel-app.yml')
  const composePath = path.join(root, appId, 'docker-compose.yml')
  const [app, compose] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(composePath, 'utf8'),
  ])
  const current = /^version: ["']?(\d+\.\d+\.\d+)["']?\s*$/m.exec(app)?.[1]
  if (!current) throw new Error('Missing or unsupported app version')
  if (compareVersions(version, current) <= 0)
    return {changed: false, version: current}

  const {token} = await (
    await get(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${imageRepo}:pull`,
    )
  ).json()
  if (typeof token !== 'string' || !token)
    throw new Error('Registry did not return a pull token')
  const response = await get(
    `https://ghcr.io/v2/${imageRepo}/manifests/${imageTag(release)}`,
    {
      Authorization: `Bearer ${token}`,
      Accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
    },
  )
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (response.headers.get('docker-content-digest') !== digest)
    throw new Error('Registry manifest digest mismatch')
  const manifest = JSON.parse(bytes.toString('utf8'))
  let supportsAmd64 = manifest.manifests?.some(
    (entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64',
  )
  if (!manifest.manifests && /^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest ?? '')) {
    const configResponse = await get(
      `https://ghcr.io/v2/${imageRepo}/blobs/${manifest.config.digest}`,
      {Authorization: `Bearer ${token}`},
    )
    const configBytes = Buffer.from(await configResponse.arrayBuffer())
    if (`sha256:${createHash('sha256').update(configBytes).digest('hex')}` !== manifest.config.digest)
      throw new Error('Registry image config digest mismatch')
    const config = JSON.parse(configBytes.toString('utf8'))
    supportsAmd64 = config.os === 'linux' && config.architecture === 'amd64'
  }
  if (!supportsAmd64) throw new Error('Image does not support linux/amd64')
  const image = `ghcr.io/${imageRepo}:${imageTag(release)}@${digest}`
  const notes = [
    release.name || release.tag_name,
    '',
    ...(release.body ? [release.body, ''] : []),
    release.html_url,
  ]
    .join('\n')
    .trim()

  function replace(source, pattern, replacement, field) {
    if (!pattern.test(source))
      throw new Error(`Missing or unsupported ${field}`)
    return source.replace(pattern, () => replacement)
  }
  let updatedApp = replace(
    app,
    /^version: .*$/m,
    `version: "${version}"`,
    'app version',
  )
  const icon = /^icon: (.+\?v=)[\d.]+$/m.exec(app)
  if (!icon) throw new Error('Missing or unsupported icon version')
  updatedApp = replace(
    updatedApp,
    /^icon: .+$/m,
    `icon: ${icon[1]}${version}`,
    'icon version',
  )
  updatedApp = replace(
    updatedApp,
    /^releaseNotes: (?:>-|\|-)\n(?:(?:[ \t].*|)\n)*/m,
    `releaseNotes: |-\n${notes
      .split('\n')
      .map((line) => line ? `  ${line}\n` : '\n')
      .join('')}`,
    'release notes',
  )
  const updatedCompose = replace(
    compose,
    new RegExp(`^    image: ghcr\\.io/${imageRepo.replaceAll('/', '\\/')}:\\S+$`, 'm'),
    `    image: ${image}`,
    'app image',
  )
  if (!dryRun) {
    await writeFile(appPath, updatedApp)
    await writeFile(composePath, updatedCompose)
  }
  return {changed: true, version, image}
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await syncRelease({dryRun: process.argv.includes('--dry-run')})
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `changed=${result.changed}\nversion=${result.version}\n`,
    )
  }
}
