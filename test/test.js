// Runs the analysis on simulated recordings and checks the results. `node test/test.js` (or `npm test`).
// The app records motion only (no microphone), so most checks use motion alone, from a quiet, well-placed phone.
const assert = require('assert');
const D = require('../src/analysis.js');

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); } };
const near = (v, want, tol, what) => assert.ok(Math.abs(v - want) <= tol, `${what} ${v}, expected ${want} ± ${tol}`);
const trueRmssd = beats => { const ibi = []; for (let i = 1; i < beats.length; i++) ibi.push(beats[i] - beats[i - 1]); let s = 0; for (let i = 1; i < ibi.length; i++) s += (ibi[i] - ibi[i - 1]) ** 2; return Math.sqrt(s / (ibi.length - 1)) * 1000; };

for (const o of [{ hr: 62, br: 13 }, { hr: 75, br: 16, seed: 3 }, { hr: 90, br: 18, seed: 5 }, { hr: 55, br: 10, seed: 9 }]) {
  check(`steady rhythm ${JSON.stringify(o)}`, () => {
    const s = D.simulate({ ...o, noise: 0.005 }), r = D.analyze({ motion: s.motion }), M = r.metrics;
    near(M.hr, o.hr, 2, 'heart rate');
    near(M.br, o.br, 1, 'breathing rate');
    near(M.rmssd, trueRmssd(s.truth), 3, 'RMSSD');
    assert.strictEqual(M.afLike, false, 'flagged as irregular');
    assert.strictEqual(M.ectopic, 0, 'early beats found');
    assert.strictEqual(r.quality.grade, 'good', 'quality grade');
  });
}
const motion = o => D.analyze({ motion: D.simulate({ noise: 0.005, ...o }).motion });
check('irregular rhythm is flagged', () => assert.strictEqual(motion({ hr: 70, irregular: true }).metrics.afLike, true));
check('extra beats are counted', () => assert.ok(motion({ hr: 64, ectopic: true, seed: 11 }).metrics.ectopic >= 3));
check('breathing pause is found', () => assert.ok(motion({ hr: 60, br: 12, apnea: true }).metrics.breathPauseS >= 12));
check('no false irregular-rhythm flags across 30 steady recordings', () => {
  const hits = []; for (const seed of [1, 2, 3, 4, 5, 6]) for (const hr of [50, 60, 70, 80, 95]) if (motion({ hr, seed }).metrics.afLike) hits.push(`${hr} bpm seed ${seed}`);
  assert.deepStrictEqual(hits, []);
});
check('beat timing is finer than the 10 ms sample grid', () => {
  const ibi = motion({ hr: 66, rsa: 1.5, seed: 4 }).ibi;
  assert.ok(ibi.some(v => v % 10 !== 0), 'every beat interval is a multiple of 10 ms');
});
const s = D.simulate({ hr: 68 });
check('sound only (older recordings)', () => near(D.analyze({ audio: s.audio }).metrics.hr, 68, 3, 'heart rate'));
check('motion without gravity', () => { const m = { ...s.motion }; delete m.tx; delete m.ty; delete m.tz; near(D.analyze({ motion: m }).metrics.hr, 68, 3, 'heart rate'); });

// known gap, reported but not enforced: with a noisier accelerometer, motion-only beat detection slips
{ let n = 0; for (const seed of [1, 2, 3, 4, 5, 6]) for (const hr of [50, 60, 70, 80, 95]) if (motion({ hr, seed, noise: 0.01 }).metrics.afLike) n++; console.log(`note  noisy accelerometer (0.01 m/s²): ${n}/30 steady recordings falsely look irregular`); }

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
