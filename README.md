# Personal Umbrel App Store

A community app store for [umbrelOS](https://umbrel.com). Add this repository URL in the Umbrel App Store to install apps from it, then add more apps later as sibling folders.

## Add this store

1. Open the App Store.
2. Click the three dots and choose **Community App Stores**.
3. Paste this URL and click **Add**:

```
https://github.com/nickpio/umbrel-app-store
```

4. Open the store and install an app.

Community App Store apps are not reviewed by Umbrel.

## Apps

| App | Folder | Requires |
| --- | --- | --- |
| sovBalance | `personal-sovbalance` | — (detects Electrs/Fulcrum/ElectrumX, Monero Node, and Zcash Node when installed) |
| Zcash Node | `personal-zcash-node` | — |

## Automatic Zcash Node updates

The **Sync latest Zcash Node release** GitHub Actions workflow checks
`nickpio/umbrel-zcash` hourly and can also be run manually from the Actions tab.
It selects the highest stable `X.Y.Z` / `vX.Y.Z` GitHub Release, excluding drafts
and prereleases. When that version is newer than this store's listing, it:

1. Resolves the public GHCR image for the exact release tag, verifies the image
   index digest and Linux amd64 support, and keeps the image digest-pinned.
2. Updates the app version, icon cache key, release notes, and image reference.
3. Commits those changes directly to `main` using this repository's
   `GITHUB_TOKEN`; no token or write access from the app repository is needed.

Equal or older versions are ignored, including releases behind a manually
published store version. Missing images, invalid digests, and API failures leave
the listing unchanged and fail the run; the next scheduled check retries.
Only Zcash Node is synced; other apps and its Tor image are left unchanged.

This updates what the store offers, not the installed application. Umbrel must
refresh the store before users see an available update. GitHub may delay scheduled
runs or disable them after prolonged repository inactivity, so distribution is
not instantaneous or guaranteed without monitoring. Keep Actions enabled and allow
`GITHUB_TOKEN` to write to `main` (branch protection must permit the bot).

Run locally with Node.js 22 or later:

```sh
node --test scripts/*.test.mjs
node scripts/sync-zcash-release.mjs --dry-run
```

## Adding another app

1. Pick an id prefixed with `personal-`, for example `personal-my-app`.
2. Create a folder with that id.
3. Add `umbrel-app.yml` and `docker-compose.yml`.
4. Set `APP_HOST` to `{app-id}_{service}_1` (for a service named `app`, that is `personal-my-app_app_1`).
