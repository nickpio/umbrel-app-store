#!/usr/bin/env node
import {appendFile} from 'node:fs/promises'
import {syncRelease} from './sync-zcash-release.mjs'

const result = await syncRelease({
  repo: 'nickpio/sovbalance',
  imageRepo: 'nickpio/sovbalance/app',
  appId: 'personal-sovbalance',
  // Daily builds publish version tags and images without GitHub Releases.
  releaseSource: 'tags',
  imageTag: (release) => release.tag_name.replace(/^v/, ''),
  dryRun: process.argv.includes('--dry-run'),
})
console.log(JSON.stringify(result))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${result.changed}\nversion=${result.version}\n`)
}
