# Alteka Kards

A cross-platform test card generator for AV professionals.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![GitHub release](https://img.shields.io/github/release/Alteka/Kards.svg)](https://GitHub.com/Alteka/Kards/releases/)
[![GitHub issues](https://img.shields.io/github/issues/Alteka/Kards.svg)](https://GitHub.com/Alteka/Kards/issues/)

## About
Good test cards are often overlooked. Maybe you set a wallpaper, maybe you have some slides in PowerPoint. This is better. We’ve made the ultimate test tool, cross platform, free and easy to use. 

Kards generates a range of useful cards, with motion, audio sync tests. You can name them, brand them. Generate tone or even a text-to-speech that voices the computer name. 

#### Accuracy
A note to say that whilst the app generates specific levels, which match standard cards (where 100% White is 235, 235, 235) display profiles and operating system settings can override these settings. Whilst this may seem like a bad thing, it's likely that the same is being done to whatever app you want to use. More information on each Kard can be seen here: [Kards Help](https://alteka.solutions/kards/help)

#### Design

The app is based around Electron to create and manage the windows. The content is heavily Vue.js driven, with some custom components to create the test cards.

#### Independent monitor outputs (EKLabs fork)

Click a monitor in the display map to edit that monitor's output. Choose its card,
name, sizing, audio, and other options, then enable its output using the existing
Enable switch. Select another monitor and repeat: enabled outputs keep running
while you edit another monitor. Green highlights identify the monitor being edited;
check marks identify enabled outputs.

Each monitor keeps its own settings across launches. Outputs and audio start off
when the application launches. Escape in an output closes only that output.
Unplugging a display closes its output and keeps the remaining outputs running.
Settings import/export and PNG export apply to the selected monitor. OSC/REST
controls continue to edit the selected output.

Run `npm run test:outputs` (Node 18 or newer) for the automated window lifecycle checks.
Physical multi-monitor validation is still required on macOS and Windows.

#### Build Setup
``` bash
# Clone the repo into a folder
# cd into the folder and run the below
# You'll need to have node.js as well as Yarn package manager
# Currently building with node 16.20.2

# install dependencies
yarn install

# serve with hot reload at localhost:9080
yarn run electron:serve

# build electron application for production
yarn run electron:build
```

---

For more information please see our website: [Alteka Solutions](https://alteka.solutions/kards)
