# MiuBon Watch iOS

Standalone iOS viewer for rendered MiuBon videos. It connects to the backend, lists rendered series/standalone videos, streams through Cloudflare or Google Drive, and syncs watch progress with the tool account.

## Build IPA for TrollStore

1. Open GitHub repo: https://github.com/Huuhoan229/miubonwatch
2. Go to `Actions`.
3. Run `Build TrollStore IPA`.
4. Download artifact `MiuBonWatch-TrollStore-IPA`.
5. Extract the artifact zip and install `MiuBonWatch-TrollStore.ipa` with TrollStore.

The IPA is built unsigned with `CODE_SIGNING_ALLOWED=NO` for TrollStore-style installation.

## Local commands

```bash
npm ci
npx cap sync ios
```