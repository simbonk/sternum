# Sternum

A phone-on-chest heart and breathing log. Lie on your back, put the iPhone (out of its case) flat on the lower breastbone, and record 60–90 seconds. The page turns the accelerometer, gyroscope and microphone signals into:

- heart rate and beat-to-beat intervals (seismo- and gyrocardiography, plus heart sounds)
- heart rate variability (RMSSD, SDNN, pNN50)
- breathing rate, regularity and pauses (from chest tilt)
- breath-linked heart rate swing (respiratory sinus arrhythmia)
- rhythm irregularity, extra beats and long gaps, with a Poincaré plot
- S1–S2 heart sound interval and an averaged heartbeat waveform

> **Experimental, not a medical device.** Sternum is a personal curiosity project. It has been tested on one person and on simulated data, it can be wrong, and it cannot rule anything out. Chest pain, fainting, severe breathlessness or a racing heart that won't settle need a doctor or emergency services, not a reading.

> **Your data stays on your phone.** There is no account, server or upload. Readings are computed and stored in the browser; the only way data leaves is a file you save or share yourself.

Each reading is compared with your own baseline (mean ± 2 SD of readings you mark as baseline) and flagged in plain language. These are wellness flags, not a diagnosis.

## Using it

Open the site in Safari on the iPhone (it must be served over https, for example on Vercel) and tap **Start reading**. Safari asks for motion and microphone access. You get a 10-second countdown to settle, a beep, the recording (60 s, 90 s or 2 min) with a live view of your pulse, chest motion, breathing and sound, then two beeps. The screen is kept awake throughout.

Add it to the Home Screen so iOS keeps its saved readings.

Readings are stored on the phone only: summaries in localStorage, raw sensor data from the last 10 readings in IndexedDB. Raw audio is kept only as 4 kHz samples for those readings and never leaves the phone unless you share it. **Sessions → Save file** saves one JSON file with your readings (and optionally raw data for the last 3) to the Files app; **Share…** opens the share sheet instead.

## Deploying

No build step is needed on the host: `index.html` is committed. On Vercel, import the repo with framework preset "Other" and no build command.

## Layout

- `src/analysis.js`: signal processing (pure functions, also runs in Node)
- `src/page.html`: the page (styles, UI, live recording, storage, sharing)
- `vendor/nosleep-media.js`: silent looping video from NoSleep.js (MIT) that keeps iOS awake
- `build.js`: inlines the analysis, keep-awake video and example readings into `index.html`
- `test/test.js`: runs the analysis on simulated recordings

```
node build.js
node test/test.js
```

## Licence

MIT, see `LICENSE`. The keep-awake video in `vendor/` is from NoSleep.js (MIT, see `vendor/NoSleep-LICENSE`).
