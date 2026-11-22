# Cassino Lab

A single-player browser card game based on classic **Cassino**, designed as the foundation for a library of configurable fishing-card games.

## Play

Once GitHub Pages is enabled, open **https://nickjt2016.github.io/cassino-lab/** on Android, desktop, or another modern browser. This is a hosted browser app: updates to `index.html` will be published at the same URL.

Current release: **v0.1.1**. The app includes a computer opponent, capturing and building, automatic scoring, game saves on the local device, and classic/Royal/Spade presets with custom rules.

## One-time GitHub Pages setup

1. Make this repository **Public** if you use GitHub Free. Navigate to **Settings → General → Danger Zone → Change repository visibility → Public**. Do not make private or sensitive content public; this repository should contain game code only.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**, then **Save**.
5. When GitHub finishes publishing, visit https://nickjt2016.github.io/cassino-lab/.

Future edits to the site files on `main` are automatically published to that same URL. No repeated downloads are needed.

## Install on Android

Open the hosted site in Chrome and choose **Add to Home screen** or **Install app** from the browser menu. An internet connection is needed on first load, then the service worker can serve the cached app offline.

The service worker uses a network-first strategy and updates its cache when the page changes. On later releases, bump the `CACHE` identifier in `service-worker.js` if the asset set changes; otherwise the app still fetches the latest page when online.

## Notes

This release keeps its game engine, styling and interface together in `index.html` as a self-contained static game. The editable modular source and tests are maintained separately in the original development package. Gameplay data is stored per browser/device; it does not yet synchronize between devices.

This is a hobbyist prototype for playtesting, not yet multiplayer or an app-store release.
