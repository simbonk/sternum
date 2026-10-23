// Builds index.html from src/: inlines the analysis, the keep-awake video and example readings.
const fs = require('fs');
const D = require('./src/analysis.js');

// example readings shown until the first real one is saved
const now = Date.UTC(2026, 9, 15, 13, 0), day = 864e5;
const plan = [
  [-13, { hr: 61, br: 13, seed: 101 }, ['Morning'], true], [-12, { hr: 59, br: 12, seed: 102 }, ['Morning'], true], [-11, { hr: 62, br: 13, seed: 103 }, ['Morning'], true],
  [-10, { hr: 60, br: 12.5, seed: 104 }, ['Morning'], true], [-8, { hr: 63, br: 13, seed: 105 }, ['Morning', 'Coffee'], false], [-7, { hr: 69, br: 14, rsa: 2, seed: 106 }, ['Morning', 'Alcohol last night'], false],
  [-5, { hr: 61, br: 13, seed: 107 }, ['Morning'], false], [-3, { hr: 64, ectopic: true, br: 13, seed: 108 }, ['Morning', 'Short sleep'], false], [-2, { hr: 60, br: 12, seed: 109 }, ['Morning'], false],
  [-1, { hr: 72, br: 16.5, rsa: 1.5, seed: 110 }, ['Morning', 'Feeling unwell'], false]];
const examples = plan.map(([d, o, tags, b], i) => {
  const r = D.analyze({ motion: D.simulate({ noise: 0.005, ...o }).motion }), keep = i >= plan.length - 3;
  return { id: 'ex' + i, ts: now + d * day - 6 * 3600e3 + i * 7e5, source: 'example', example: true, tags, note: '', baseline: b,
    durationS: r.durationS, metrics: r.metrics, quality: r.quality, hrSource: r.hrSource, agree: r.agree, notes: r.notes, ibi: r.ibi, traces: keep ? r.traces : {}, templates: r.templates, soundNote: r.soundNote };
});

const dsp = fs.readFileSync('src/analysis.js', 'utf8').replace("if (typeof module !== 'undefined') module.exports = DSP;", '');
const nosleep = fs.readFileSync('vendor/nosleep-media.js', 'utf8');
const body = fs.readFileSync('src/page.html', 'utf8').replace('/*__NOSLEEP__*/', () => nosleep).replace('/*__DSP__*/', () => dsp).replace('/*__EXAMPLES__*/[]', () => JSON.stringify(examples));
const head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Sternum"><meta name="theme-color" content="#C2313B">' +
  '<link rel="icon" href="icons/icon.svg" type="image/svg+xml"><link rel="icon" href="icons/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="icons/icon-180.png"><link rel="manifest" href="manifest.webmanifest">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
fs.writeFileSync('index.html', head + body + '</body></html>');
console.log('built index.html', (head + body).length, 'bytes');
