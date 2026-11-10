# Alteka Kards — EKLabs fork

A cross-platform test card generator for AV professionals, extended with independently configurable outputs for multiple monitors.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

Based on [Alteka/Kards](https://github.com/Alteka/Kards), created by [Alteka Solutions](https://alteka.solutions/kards). This fork retains the original GPL-3.0-only license; see [LICENSE](LICENSE).

## Features

- Test cards including Alteka, bars, grid, ramp, name, audio sync, DeGhost, and LED layouts.
- Independent card selection, naming, sizing, appearance, audio settings, and output visibility for each monitor.
- Fullscreen or windowed output, motion, information overlays, custom branding, and image export.
- Saved settings for each monitor, with outputs and audio disabled at startup.

## Using multiple monitors

1. Connect your monitors and launch Kards.
2. Click a monitor in the display map to select the output you want to edit.
3. Choose its test card and configure its name, sizing, appearance, and audio.
4. Turn on **Enable** to show that monitor's output.
5. Select another monitor and repeat. Outputs already enabled keep running while you edit another monitor.

The green highlight identifies the monitor being edited. Check marks identify enabled outputs. Changing the selected monitor changes which settings the controls edit.

Each monitor keeps its own settings across launches. Pressing **Escape** in an output closes only that output; Escape in the control window disables the selected output. Disconnecting a monitor closes its output while the remaining outputs continue running.

Settings import/export and PNG export apply to the selected monitor. OSC and REST controls also operate on the selected output; selecting a screen through those interfaces selects the monitor to edit.

## Development setup

The application uses Electron and Vue 3. Git and Node.js with npm are required. Renderer and Electron bundle builds have been checked with Node.js **22.16.0**. The upstream project documents Node.js 16.20.2; the output tests require Node.js 18 or newer.

```sh
git clone --branch codex/independent-monitor-outputs https://github.com/jacelias10/Alteka-Kards-EKLabs-fork.git
cd Alteka-Kards-EKLabs-fork
npm install --legacy-peer-deps
```

Yarn is included as a local development dependency because Vue CLI detects the repository’s `yarn.lock` during startup. A global Yarn installation is not required.

Create the local environment file before starting or building the app. The example leaves optional Rollbar reporting unconfigured.

macOS / Linux:

```sh
cp env.json.example env.json
```

Windows PowerShell:

```powershell
Copy-Item env.json.example env.json
```

The project uses an older Webpack toolchain. Before running build commands with Node.js 22, enable its OpenSSL compatibility option:

```sh
# macOS / Linux
export NODE_OPTIONS=--openssl-legacy-provider
```

```powershell
# Windows PowerShell
$env:NODE_OPTIONS = '--openssl-legacy-provider'
```

Start the Electron app with hot reload (the launcher handles Webpack compatibility and keeps that option out of Electron’s environment):

```sh
npm run electron:serve
```

The control window opens without developer tools. Set `OPEN_DEVTOOLS=1` before launching if you need them.

Build the desktop application:

```sh
npm run electron:build
```

Compile the renderer, main process, and preload scripts without packaging an installer:

```sh
npm run electron:build -- --skipElectronBuild
```

## Validation

```sh
npm run test:outputs
npm run lint -- --no-fix src/background.js src/components/Control/ControlScreen.vue
```

The output tests use simulated Electron windows and displays. They cover independent settings and edits, window mode changes, output shortcuts, display disconnects, saved settings, export routing, and shutdown.

The Electron bundle compiles, and a local macOS startup and output-enable smoke test has been performed. **Simultaneous output on physical monitors still needs validation**, including fullscreen behavior on macOS and Windows. No packaged installer for this feature has been validated.

## Output accuracy

Display profiles and operating system settings can alter generated levels. Verify the complete display chain when using Kards for calibration. See the upstream [Kards help](https://alteka.solutions/kards/help) for card-specific information.

## Upstream project

- [Original source](https://github.com/Alteka/Kards)
- [Upstream releases](https://github.com/Alteka/Kards/releases)
- [Alteka Solutions](https://alteka.solutions/kards)

Upstream release downloads belong to the original project and do not include this fork's multi-monitor changes.
