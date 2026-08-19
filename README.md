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
| sovBalance | `personal-sovbalance` | Electrs, Monero Node |
| Zcash Node | `personal-zcash-node` | — |

## Adding another app

1. Pick an id prefixed with `personal-`, for example `personal-my-app`.
2. Create a folder with that id.
3. Add `umbrel-app.yml` and `docker-compose.yml`.
4. Set `APP_HOST` to `{app-id}_{service}_1` (for a service named `app`, that is `personal-my-app_app_1`).
