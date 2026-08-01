# Working on TV Tycoon

Read this before touching dependencies, the Expo SDK, or anything about running
the app. Every line here was paid for with a debugging session.

## The single most important fact: SDK is pinned by the phone, not by choice

The target device's Expo Go supports **Expo SDK 54** and cannot install a newer
Expo Go (the iOS version is too old for it). So **54 is a hard ceiling, not a
preference.** Do not "upgrade to the latest SDK" — the latest SDK is exactly what
the phone cannot run.

- `expo` is pinned to `~54`, `react-native` `0.81.x`, `react` `19.1.x`.
- Expo Go runs **only the one SDK it was built for.** A project on any other SDK
  shows `Project is incompatible with this version of Expo Go`. Matching is the
  whole game.
- If you must change the SDK, change it to whatever the device's Expo Go reports
  under its own version screen — nothing else.

Read the versioned docs for the SDK actually in use before writing native code:
https://docs.expo.dev/versions/v54.0.0/

## Never tell the user "it'll run" without verifying the bundle builds

A green typecheck says nothing about whether Expo Go can load the app. Two curls
against a running `npx expo start --offline` do:

```bash
IP=$(ipconfig getifaddr en0)   # the LAN address, not localhost

# 1. Manifest — runtimeVersion MUST read exposdk:54.0.0
curl -s -H "expo-platform: ios" -H "accept: application/expo+json,application/json" \
  "http://$IP:8081/" | python3 -c "import sys,json;print(json.load(sys.stdin)['runtimeVersion'])"

# 2. The actual bundle the phone downloads — MUST be HTTP 200 and real JS, not a
#    JSON error payload. This is what "No script URL"/blank-screen failures are.
curl -s -o /tmp/b.js -w "%{http_code} %{size_download}\n" \
  "http://$IP:8081/index.ts.bundle?platform=ios&dev=true"
head -c 40 /tmp/b.js   # starts with "var __BUNDLE..." = good; "{" = error
```

If those two pass, it runs. If you skip them, you are guessing.

## What is and isn't installed, and why

Animations use React Native's own `Animated` API; the pitch-table swipes use
`PanResponder`. Nothing imports Reanimated, Worklets, Gesture Handler or Skia —
they were declared but never used, and they are the reason the project once could
not run in plain Expo Go at all. **They are deleted. Do not re-add them** unless a
feature genuinely needs them, and know that doing so takes the app off Expo Go and
onto a custom dev build.

The real native surface is small and all Expo-Go-bundled: `react-native-svg`
(posters, portraits), `expo-haptics`, `expo-linear-gradient`, `expo-status-bar`,
`@react-native-async-storage/async-storage`.

## Gotchas that have each cost an hour

- **`expo-status-bar` is not a config plugin on SDK 54.** Listing it under
  `plugins` in `app.json` fails the manifest before any code runs. Import the
  component; don't plug it in.
- **Stale Expo login → HTTP 500 `UnexpectedServerData: No returned query result`**
  from the manifest handler. Fix: `npx expo logout`, or run with `--offline`.
- **Node must be 22.** `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` before
  any `npm`/`npx`. System Node is ancient and fails silently in odd ways.
- **One Metro at a time.** A second `expo start` grabs port 8082 and the phone
  loads a half-built second bundler. Kill `pkill -f "expo start"` before starting.
- **Never run `npm run shots` twice concurrently** — it binds a fixed port.

## Verifying game logic

`npm run check` runs six suites (typecheck, 56 vitest tests, playthrough, money,
migration, render). All must pass. The vitest timeout is 30s per test on purpose:
several tests simulate 200–400 in-game weeks and are legitimately slow.

## A dead end, recorded so it isn't retried

Native device builds (`expo run:ios`, Xcode, EAS) were explored and abandoned:
the physical-device path needs either a working cable (the user's is charge-only)
or the paid Apple Developer Program for wireless install. **Expo Go over Wi-Fi is
the supported no-cable, no-cost path** and is how the app is run. Don't reach for
the native toolchain again without a new reason.
