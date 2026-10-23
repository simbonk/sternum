/* Sternum signal analysis: seismocardiography (accelerometer + gyroscope),
   phonocardiography (microphone) and chest-tilt breathing. Pure functions. */
const DSP = (() => {
  const FS = 100; // working rate for motion and envelopes

  const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; };
  const median = a => { if (!a.length) return NaN; const b = Float64Array.from(a).sort(); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const std = a => { if (a.length < 2) return NaN; const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / (a.length - 1)); };
  const pct = (a, p) => { const b = Float64Array.from(a).sort(); if (!b.length) return NaN; return b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))]; };
  const round = (v, d = 0) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

  function resample(t, v, fs, t0, t1) {
    const n = Math.max(0, Math.floor((t1 - t0) * fs));
    const out = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const tt = t0 + i / fs;
      while (j < t.length - 2 && t[j + 1] < tt) j++;
      const ta = t[j], tb = j + 1 < t.length ? t[j + 1] : ta;
      const vb = j + 1 < v.length ? v[j + 1] : v[j];
      const f = tb > ta ? Math.min(1, Math.max(0, (tt - ta) / (tb - ta))) : 0;
      out[i] = v[j] + (vb - v[j]) * f;
    }
    return out;
  }

  function biquad(type, f0, fs, Q = Math.SQRT1_2) {
    const w = 2 * Math.PI * f0 / fs, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q), a0 = 1 + al;
    const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    return [b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - al) / a0];
  }
  function runBQ(x, co) {
    const [b0, b1, b2, a1, a2] = co, y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // zero-phase filtering with reflected padding
  function filtfilt(x, co, pad) {
    const n = x.length; if (n < 4) return Float64Array.from(x);
    const p = Math.min(n - 1, pad);
    const ext = new Float64Array(n + 2 * p);
    for (let i = 0; i < p; i++) ext[i] = 2 * x[0] - x[p - i];
    ext.set(x, p);
    for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    let y = runBQ(ext, co); y.reverse(); y = runBQ(y, co); y.reverse();
    return y.subarray(p, p + n);
  }
  function bandpass(x, fs, lo, hi, order = 2) {
    const m = mean(x); let y = Float64Array.from(x, v => v - m);
    const pad = Math.round(fs * Math.min(3, 1.5 / Math.max(lo, 0.05)));
    for (let k = 0; k < order; k++) {
      if (lo > 0) y = filtfilt(y, biquad('hp', lo, fs), pad);
      if (hi < fs / 2) y = filtfilt(y, biquad('lp', hi, fs), pad);
    }
    return Float64Array.from(y);
  }
  function movAvg(x, w) {
    w = Math.max(1, Math.round(w)); const n = x.length, y = new Float64Array(n), h = w >> 1;
    const cs = new Float64Array(n + 1); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); y[i] = (cs[b] - cs[a]) / (b - a); }
    return y;
  }
  function decimate(x, f) {
    f = Math.max(1, Math.round(f)); const n = Math.floor(x.length / f), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += x[i * f + k]; y[i] = s / f; }
    return y;
  }

  // normalized autocorrelation, returns {lag (samples, refined), r}
  function period(x, minLag, maxLag) {
    const m = mean(x), d = Float64Array.from(x, v => v - m), n = d.length;
    maxLag = Math.min(maxLag, Math.floor(n / 2));
    const r = new Float64Array(maxLag + 2);
    for (let L = Math.max(1, minLag - 1); L <= maxLag + 1 && L < n; L++) {
      let s = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + L < n; i++) { s += d[i] * d[i + L]; e1 += d[i] * d[i]; e2 += d[i + L] * d[i + L]; }
      r[L] = e1 && e2 ? s / Math.sqrt(e1 * e2) : 0;
    }
    const peaks = [];
    for (let L = minLag; L <= maxLag; L++) if (r[L] >= r[L - 1] && r[L] >= r[L + 1] && r[L] > 0) peaks.push(L);
    if (!peaks.length) return { lag: NaN, r: 0, curve: r };
    const top = peaks.reduce((a, b) => r[b] > r[a] ? b : a);
    // prefer the shortest strong lag, so multiples of the true period lose
    const best = peaks.find(L => r[L] >= 0.85 * r[top]);
    const y0 = r[best - 1], y1 = r[best], y2 = r[best + 1], den = y0 - 2 * y1 + y2;
    const off = den ? 0.5 * (y0 - y2) / den : 0;
    return { lag: best + Math.max(-0.5, Math.min(0.5, off)), r: r[best], curve: r };
  }

  function findPeaks(x, minDist, thr) {
    const out = [], k = Math.max(1, Math.round(minDist));
    for (let i = 1; i < x.length - 1; i++) {
      if (x[i] <= thr || x[i] < x[i - 1] || x[i] < x[i + 1]) continue;
      let ok = true;
      for (let j = Math.max(0, i - k); j <= Math.min(x.length - 1, i + k); j++) if (x[j] > x[i] || (x[j] === x[i] && j < i)) { ok = false; break; }
      if (ok) out.push(i);
    }
    return out;
  }

  // envelope of heartbeat energy from one motion channel
  function beatEnvelope(x, fs) {
    const bp = bandpass(x, fs, 5, Math.min(30, fs * 0.42));
    const sq = Float64Array.from(bp, v => v * v);
    const cap = pct(sq, 0.995), med = pct(sq, 0.5) || 1e-12;
    for (let i = 0; i < sq.length; i++) sq[i] = Math.min(sq[i], cap) / med;
    const sm = movAvg(sq, 0.12 * fs), slow = movAvg(sm, 1.5 * fs);
    return { env: Float64Array.from(sm, (v, i) => v - slow[i]), bp, artifact: countArtifacts(bp, fs) };
  }
  function countArtifacts(bp, fs) {
    // seconds where energy is far above typical (movement, bumps)
    const w = fs, sec = Math.floor(bp.length / w), e = [];
    for (let s = 0; s < sec; s++) { let a = 0; for (let i = s * w; i < (s + 1) * w; i++) a += bp[i] * bp[i]; e.push(a); }
    const m = median(e); return e.filter(v => v > 12 * m).length;
  }

  function detectBeats(env, fs, P) {
    const hi = pct(env, 0.95), mid = pct(env, 0.5);
    const thr = mid + 0.25 * (hi - mid);
    const pk = findPeaks(env, Math.max(0.28 * fs, 0.42 * P), thr);
    // drop the weaker of two close peaks when it is much smaller (second heart sound / AC wave, noise)
    let out = [];
    for (const i of pk) {
      const prev = out[out.length - 1];
      if (prev !== undefined && i - prev < 0.6 * P) {
        const a = env[prev], b = env[i];
        if (b < 0.6 * a) continue;
        if (a < 0.6 * b) { out[out.length - 1] = i; continue; }
      }
      out.push(i);
    }
    // weak peaks that crowd a neighbour are noise; weak peaks that fill a gap are kept
    const amp = median(out.map(i => env[i]));
    out = out.filter((i, k) => {
      if (env[i] >= 0.45 * amp) return true;
      const gp = k ? i - out[k - 1] : Infinity, gn = k < out.length - 1 ? out[k + 1] - i : Infinity;
      return Math.min(gp, gn) > 0.75 * P;
    });
    // look again inside long gaps with a lower bar
    const filled = [];
    for (let k = 0; k < out.length; k++) {
      filled.push(out[k]);
      const nx = out[k + 1];
      if (nx === undefined || nx - out[k] < 1.4 * P) continue;
      // a missed weak beat sits near the middle of the gap
      const c = (out[k] + nx) / 2, half = 0.2 * (nx - out[k]);
      let b = -1;
      for (let i = Math.round(c - half); i <= c + half; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && (b < 0 || env[i] > env[b])) b = i;
      if (b > 0 && env[b] > mid + 0.1 * (hi - mid)) filled.push(b);
    }
    return filled;
  }

  // a second chest-motion complex (valve closing) can pass for a beat, splitting one interval into two halves;
  // drop the middle beat when two short intervals add up to one normal one. An early beat gives short-then-long, not two halves.
  function mergeSplit(beats) {
    const out = beats.slice();
    for (let pass = 0; pass < 2; pass++) {
      const ibi = []; for (let i = 1; i < out.length; i++) ibi.push(out[i] - out[i - 1]);
      const drop = new Set();
      for (let i = 0; i + 1 < ibi.length; i++) {
        const lm = median(ibi.slice(Math.max(0, i - 6), i + 8)), sum = ibi[i] + ibi[i + 1];
        if (ibi[i] < 0.65 * lm && ibi[i + 1] < 0.65 * lm && Math.abs(sum - lm) < 0.15 * lm) { drop.add(i + 1); i++; }
      }
      if (!drop.size) break;
      for (let k = out.length - 1; k >= 0; k--) if (drop.has(k)) out.splice(k, 1);
    }
    return out;
  }

  // sub-sample peak position from a parabola through the peak and its neighbours
  function subPeak(x, i) {
    if (i <= 0 || i >= x.length - 1) return i;
    const a = x[i - 1], b = x[i], c = x[i + 1], d = a - 2 * b + c;
    return d < 0 ? i + Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : i;
  }

  // pos: optional sub-sample beat positions, so beat timing is not stuck on the 10 ms sample grid
  function rhythm(beats, fs, dur, pos) {
    const t = (pos || beats).map(i => i / fs), ibi = [];
    for (let i = 1; i < t.length; i++) ibi.push(t[i] - t[i - 1]);
    const valid = ibi.map(v => v > 0.3 && v < 2.4);
    const lm = ibi.map((_, i) => median(ibi.slice(Math.max(0, i - 3), i + 4).filter((v, k) => v > 0.3 && v < 2.4)));
    const abn = ibi.map((v, i) => !valid[i] || Math.abs(v - lm[i]) / lm[i] > 0.2);
    const clean = ibi.filter((_, i) => !abn[i]);
    const med = median(clean.length >= 5 ? clean : ibi.filter((_, i) => valid[i]));
    let sd2 = 0, nd = 0, nn50 = 0, big = 0, nb = 0;
    for (let i = 1; i < ibi.length; i++) {
      if (valid[i] && valid[i - 1]) { nb++; if (Math.abs(ibi[i] - ibi[i - 1]) / ((ibi[i] + ibi[i - 1]) / 2) > 0.12) big++; }
      if (!abn[i] && !abn[i - 1]) { const d = ibi[i] - ibi[i - 1]; sd2 += d * d; nd++; if (Math.abs(d) > 0.05) nn50++; }
    }
    let ectopic = 0;
    for (let i = 0; i + 1 < ibi.length; i++) if (valid[i] && ibi[i] < 0.8 * lm[i] && ibi[i + 1] > 1.1 * lm[i]) { ectopic++; i++; }
    const pauses = ibi.filter(v => v > Math.max(2.0, 1.8 * med) && v < 4).length;
    // atrial-fibrillation-style irregularity (Dash et al. 2009): big beat-to-beat changes that are also random,
    // unlike breathing-linked swings, which rise and fall smoothly over several beats
    const rr = [];
    for (let i = 0; i < ibi.length; i++) {
      if (!valid[i]) continue;
      if (i + 1 < ibi.length && ibi[i] < 0.8 * lm[i] && ibi[i + 1] > 1.1 * lm[i]) { i++; continue; }
      rr.push(ibi[i]);
    }
    let af = null;
    if (rr.length >= 40) {
      let s2 = 0, tp = 0;
      for (let i = 1; i < rr.length; i++) s2 += (rr[i] - rr[i - 1]) ** 2;
      for (let i = 1; i + 1 < rr.length; i++) if ((rr[i] - rr[i - 1]) * (rr[i + 1] - rr[i]) < 0) tp++;
      const nrmssd = Math.sqrt(s2 / (rr.length - 1)) / mean(rr), tpr = tp / (rr.length - 2);
      const srt = rr.slice().sort((a, b) => a - b).slice(8, -8), lo = srt[0], hi = srt[srt.length - 1], h = new Array(16).fill(0);
      for (const v of srt) h[Math.min(15, Math.floor((v - lo) / ((hi - lo) || 1) * 16))]++;
      const she = -h.filter(Boolean).reduce((a, c) => a + c / srt.length * Math.log(c / srt.length), 0) / Math.log(16);
      // a random sequence turns about 2/3 of the time; breathing-linked swings turn far less often (~0.3)
      af = { nrmssd, tpr, she, likely: nrmssd >= 0.1 && she >= 0.7 && tpr >= 0.5 && tpr <= 0.8 };
    }
    const covered = clean.reduce((a, b) => a + b, 0) / dur;
    return {
      t, ibi,
      hr: 60 / med,
      rmssd: nd > 3 ? Math.sqrt(sd2 / nd) * 1000 : NaN,
      sdnn: clean.length > 4 ? std(clean) * 1000 : NaN,
      pnn50: nd > 3 ? 100 * nn50 / nd : NaN,
      irregPct: nb > 5 ? 100 * big / nb : NaN,
      ectopic, pauses, coverage: Math.min(1, covered), beats: t.length,
      afLike: af ? af.likely : null, nrmssd: af ? af.nrmssd : NaN, tpr: af ? af.tpr : NaN, rrEntropy: af ? af.she : NaN
    };
  }

  function template(sig, beats, fs, pre, post) {
    const a = Math.round(pre * fs), b = Math.round(post * fs), out = new Float64Array(a + b);
    let n = 0;
    for (const i of beats) {
      if (i - a < 0 || i + b > sig.length) continue;
      for (let k = 0; k < a + b; k++) out[k] += sig[i - a + k];
      n++;
    }
    if (n) for (let k = 0; k < out.length; k++) out[k] /= n;
    return { tpl: out, n };
  }

  // how alike individual beats are to their average (works for irregular rhythms too)
  function consistency(sig, beats, fs, pre, post) {
    const { tpl, n } = template(sig, beats, fs, pre, post);
    if (n < 5) return 0;
    const a = Math.round(pre * fs), cs = [];
    for (const i of beats) {
      if (i - a < 0 || i - a + tpl.length > sig.length) continue;
      cs.push(corr(Array.from(sig.subarray ? sig.subarray(i - a, i - a + tpl.length) : sig.slice(i - a, i - a + tpl.length)), Array.from(tpl)));
    }
    return median(cs.filter(Number.isFinite));
  }

  // 2-D principal axis projection, for chest tilt -> breathing
  function principal(a, b) {
    const ma = mean(a), mb = mean(b); let saa = 0, sbb = 0, sab = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; saa += x * x; sbb += y * y; sab += x * y; }
    const th = 0.5 * Math.atan2(2 * sab, saa - sbb), c = Math.cos(th), s = Math.sin(th);
    return Float64Array.from(a, (v, i) => (v - ma) * c + (b[i] - mb) * s);
  }

  function breathing(sig, fs, beatT, instHR, soundT) {
    // work at 10 Hz
    const f = Math.round(fs / 10), x = decimate(sig, f), fb = fs / f;
    const bp = bandpass(x, fb, 0.08, 0.9);
    const p = period(bp, Math.round(2 * fb), Math.round(15 * fb));
    const P = p.lag;
    if (!Number.isFinite(P)) return { br: NaN, q: 0, trace: bp };
    // breaths are often sharp dips with flat tops (or the reverse): point the sharp side up before counting
    const m0 = mean(bp); let sk = 0; for (const v of bp) sk += (v - m0) ** 3;
    const y = sk < 0 ? Float64Array.from(bp, v => -v) : bp;
    // judge each breath against its neighbours, so shallow stretches still count but a flat pause does not
    const gRange = pct(y, 0.98) - pct(y, 0.02), hw = Math.round(0.8 * P), sw = Math.round(0.5 * P);
    const prom = {};
    const pk = findPeaks(y, 0.55 * P, -Infinity).filter(i => {
      let lo = Infinity, hi = -Infinity, l = Infinity, r = Infinity;
      for (let k = Math.max(0, i - hw); k <= Math.min(y.length - 1, i + hw); k++) { lo = Math.min(lo, y[k]); hi = Math.max(hi, y[k]); }
      for (let k = Math.max(0, i - sw); k < i; k++) l = Math.min(l, y[k]);
      for (let k = i + 1; k <= Math.min(y.length - 1, i + sw); k++) r = Math.min(r, y[k]);
      const lr = hi - lo; prom[i] = y[i] - Math.max(l, r);
      return lr >= 0.1 * gRange && prom[i] >= 0.3 * lr;
    });
    const bi = []; for (let i = 1; i < pk.length; i++) bi.push((pk[i] - pk[i - 1]) / fb);
    // a pause is a long gap between breaths, well inside the recording (filter edges excluded)
    // only clear breaths count here, so filter ringing inside a real pause does not hide it
    const edge = 5 * fb, mBi = median(bi), strong = pk.filter(i => prom[i] >= 0.2 * gRange);
    let pauseS = 0;
    for (let i = 1; i < strong.length; i++) {
      const gap = (strong[i] - strong[i - 1]) / fb;
      // two or more shallow breaths inside the gap means shallow breathing, not a pause
      const shallow = pk.filter(k => k > strong[i - 1] && k < strong[i]).length;
      // the microphone hearing breaths inside the gap also rules out a pause
      const heard = (soundT || []).some(t => t > strong[i - 1] / fb + 2 && t < strong[i] / fb - 2);
      if (!heard && strong[i - 1] > edge && strong[i] < y.length - edge && gap > Math.max(12, 2.5 * mBi) && shallow < 2) pauseS = Math.max(pauseS, gap);
    }
    // breath-linked heart-rate swing (respiratory sinus arrhythmia)
    let rsa = NaN;
    if (instHR && instHR.length > 4) {
      const sw = [];
      for (let i = 1; i < pk.length; i++) {
        const a = pk[i - 1] / fb, b = pk[i] / fb, hrs = instHR.filter(h => h.t >= a && h.t < b).map(h => h.v);
        if (hrs.length >= 2) sw.push(Math.max(...hrs) - Math.min(...hrs));
      }
      if (sw.length >= 2) rsa = median(sw);
    }
    return {
      br: 60 * fb / P, q: p.r,
      brCV: bi.length > 2 ? 100 * std(bi) / mean(bi) : NaN,
      pauseS,
      rsa, trace: bp, fs: fb
    };
  }

  // --- microphone: breath sounds (airflow noise) -> times of breaths, 10 Hz envelope
  function breathSounds(samples, sr) {
    let x = Float64Array.from(samples);
    const f1 = Math.max(1, Math.round(sr / 4000)), fa = sr / f1;
    if (f1 > 1) x = decimate(x, f1);
    x = bandpass(x, fa, 100, Math.min(1500, fa * 0.4));
    const sq = Float64Array.from(x, v => v * v), f2 = Math.round(fa / 10);
    const env = Float64Array.from(decimate(movAvg(sq, 0.3 * fa), f2), Math.sqrt);
    const p70 = pct(env, 0.7), p20 = pct(env, 0.2), w = 20;
    const pk = findPeaks(env, 25, p70).filter(i => {
      let l = Infinity, r = Infinity;
      for (let k = Math.max(0, i - w); k < i; k++) l = Math.min(l, env[k]);
      for (let k = i + 1; k <= Math.min(env.length - 1, i + w); k++) r = Math.min(r, env[k]);
      return env[i] - Math.max(l, r) >= 0.5 * (p70 - p20);
    });
    // only trust it when the sound rises and falls at a breathing pace rather than with each heartbeat
    const pB = period(env, 20, 150), pH = period(env, 3, 16);
    if (!(pB.r >= 0.25 && pB.r > pH.r)) return null;
    const t = pk.map(i => i / 10), bi = [];
    for (let i = 1; i < t.length; i++) bi.push(t[i] - t[i - 1]);
    return { t, br: t.length >= 5 ? 60 / median(bi) : NaN, q: pB.r };
  }

  // --- microphone: heart sounds -> 100 Hz envelope
  function audioEnvelope(samples, sr) {
    let x = Float64Array.from(samples);
    x = filtfilt(x, biquad('lp', 300, sr), Math.round(sr * 0.05));
    const f1 = Math.max(1, Math.round(sr / 1000)), fa = sr / f1;
    x = decimate(x, f1);
    x = bandpass(x, fa, 25, 140);
    const ref = pct(Float64Array.from(x, Math.abs), 0.999) || 1;
    const se = Float64Array.from(x, v => { const n = Math.min(1, Math.abs(v) / ref), q = n * n; return -q * Math.log(q + 1e-10); });
    const f2 = Math.round(fa / FS);
    const sharp = decimate(movAvg(se, 0.02 * fa), f2);
    const sm = movAvg(sharp, 0.06 * FS), slow = movAvg(sm, 1.5 * FS);
    const loud = pct(Float64Array.from(x, Math.abs), 0.5);
    return { env: Float64Array.from(sm, (v, i) => v - slow[i]), sharp, noise: loud / ref };
  }

  function heartSounds(sharp, beats, P) {
    const { tpl, n } = template(sharp, beats, FS, 0.35, 0.95);
    if (n < 5) return null;
    const z = 35, b = Math.round(0.02 * FS);
    const loc = findPeaks(tpl, b, pct(tpl, 0.6)).filter(i => i !== z);
    // biggest peak other than the aligned one, 0.18-0.6 s away
    let best = -1;
    for (const i of loc) { const d = Math.abs(i - z) / FS; if (d >= 0.18 && d <= 0.6 && (best < 0 || tpl[i] > tpl[best])) best = i; }
    if (best < 0) return { tpl: Array.from(tpl), s1s2: NaN, ratio: NaN, s1: z };
    const d = Math.abs(best - z) / FS, per = P / FS;
    let s1, s2;
    if (best > z) { if (d < per / 2) { s1 = z; s2 = best; } else { s1 = best; s2 = z; } }
    else { if (d < per / 2) { s1 = best; s2 = z; } else { s1 = z; s2 = best; } }
    const refine = i => { const y0 = tpl[i - 1] ?? tpl[i], y1 = tpl[i], y2 = tpl[i + 1] ?? tpl[i], dd = y0 - 2 * y1 + y2; return i + (dd ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / dd)) : 0); };
    let s1s2 = (refine(s2) - refine(s1)) / FS; if (s1s2 < 0) s1s2 += per;
    return { tpl: Array.from(tpl), s1s2: s1s2 * 1000, ratio: tpl[s2] / tpl[s1], s1, s2 };
  }

  function instantHR(r) {
    const out = [];
    for (let i = 0; i < r.ibi.length; i++) if (r.ibi[i] > 0.3 && r.ibi[i] < 2.4) out.push({ t: r.t[i + 1], v: 60 / r.ibi[i] });
    // 3-beat median to keep one misplaced beat from inflating the breath-linked swing
    return out.map((h, i) => ({ t: h.t, v: median(out.slice(Math.max(0, i - 1), i + 2).map(o => o.v)) }));
  }

  // breathing from the heart itself: heart rate rises on each in-breath and falls on each out-breath
  function breathFromHR(ihr) {
    if (!ihr || ihr.length < 30) return null;
    const fs = 4, t = ihr.map(h => h.t), v = ihr.map(h => h.v);
    const x = resample(t, v, fs, t[0], t[t.length - 1]);
    if (x.length < 30 * fs) return null;
    const bp = bandpass(x, fs, 0.07, 0.5);
    const p = period(bp, 2 * fs, 15 * fs);
    return Number.isFinite(p.lag) ? { br: 60 * fs / p.lag, q: p.r } : null;
  }

  /* rec: { motion: { t:[s], ax,ay,az, gx,gy,gz, tx,ty,tz (tilt/gravity, optional) }, audio: { samples, sr } } */
  function analyze(rec) {
    const res = { metrics: {}, quality: {}, notes: [] };
    let mot = null, aud = null;
    const m = rec.motion;
    const bsnd = rec.audio && rec.audio.samples && rec.audio.samples.length > rec.audio.sr * 20 ? breathSounds(rec.audio.samples, rec.audio.sr) : null;
    if (m && m.t && m.t.length > 200) {
      const t0 = m.t[0], t1 = m.t[m.t.length - 1], dur = t1 - t0;
      const rs = k => m[k] && m[k].length === m.t.length ? resample(m.t, m[k], FS, t0, t1) : null;
      const ch = ['az', 'ax', 'ay', 'gx', 'gy', 'gz'].map(k => [k, rs(k)]).filter(c => c[1]);
      const envs = ch.map(([k, x]) => { const e = beatEnvelope(x, FS); const p = period(e.env, Math.round(0.33 * FS), Math.round(1.6 * FS)); return { k, x, ...e, q: p.r }; });
      let wsum = 0; const comb = new Float64Array(envs[0].env.length);
      for (const e of envs) { const w = Math.max(0, e.q) ** 2; wsum += w; for (let i = 0; i < comb.length; i++) comb[i] += w * e.env[i]; }
      if (wsum) for (let i = 0; i < comb.length; i++) comb[i] /= wsum;
      const p = period(comb, Math.round(0.33 * FS), Math.round(1.6 * FS));
      let main = envs.reduce((a, b) => b.q > a.q ? b : a);
      let beats = Number.isFinite(p.lag) ? detectBeats(comb, FS, p.lag) : [], peakSig = comb;
      for (let pass = 0; pass < 3 && beats.length > 8; pass++) {
        // matched filter: correlate each channel with its own average beat, then combine
        const mf = new Float64Array(comb.length), a = Math.round(0.15 * FS), L = Math.round(0.6 * FS);
        for (const e of envs) {
          const { tpl } = template(e.bp, beats, FS, 0.15, 0.45);
          const noise = pct(Float64Array.from(e.bp, v => v * v), 0.5) / 0.455 || 1;
          for (let i = a; i + L - a < e.bp.length; i++) {
            let s = 0; for (let k = 0; k < L; k++) s += tpl[k] * e.bp[i - a + k];
            mf[i] += s / noise;
          }
        }
        const pos = Float64Array.from(mf, v => Math.max(0, v));
        const sm = movAvg(pos, 0.05 * FS), slow = movAvg(sm, 1.5 * FS);
        // beat strength rises and falls with breathing; even it out so weak beats are not missed
        const raw2 = Float64Array.from(sm, (v, i) => Math.max(0, v - slow[i]));
        const W = Math.round(1.2 * p.lag), floor = 0.15 * pct(raw2, 0.95), env2 = new Float64Array(raw2.length);
        for (let i = 0; i < raw2.length; i++) { let mx = 0; for (let k = Math.max(0, i - W); k <= Math.min(raw2.length - 1, i + W); k++) if (raw2[k] > mx) mx = raw2[k]; env2[i] = raw2[i] / Math.max(mx, floor); }
        comb.set(env2);
        // snap each beat to the sharpest matched-filter peak nearby
        const w = Math.round(0.08 * FS);
        beats = detectBeats(env2, FS, p.lag).map(i => { let b = i; for (let k = Math.max(0, i - w); k <= Math.min(mf.length - 1, i + w); k++) if (mf[k] > mf[b]) b = k; return b; });
        peakSig = mf;
      }
      beats = mergeSplit(beats);
      const r = rhythm(beats, FS, dur, beats.map(i => subPeak(peakSig, i)));
      const tp = template(main.bp, beats, FS, 0.2, 0.6);
      // breathing from chest tilt (gravity) when present, otherwise integrated gyro, otherwise low-passed acceleration
      let bsig = null;
      const tx = rs('tx'), ty = rs('ty'), tz = rs('tz');
      if (tx && ty && tz) {
        const pitch = Float64Array.from(ty, (v, i) => Math.atan2(v, tz[i])), roll = Float64Array.from(tx, (v, i) => Math.atan2(v, tz[i]));
        bsig = principal(pitch, roll);
      } else if (rs('gx') && rs('gy')) {
        const gx = rs('gx'), gy = rs('gy'), ix = new Float64Array(gx.length), iy = new Float64Array(gy.length);
        for (let i = 1; i < gx.length; i++) { ix[i] = ix[i - 1] + gx[i] / FS; iy[i] = iy[i - 1] + gy[i] / FS; }
        bsig = principal(bandpass(ix, FS, 0.05, 2), bandpass(iy, FS, 0.05, 2));
      } else if (rs('az')) bsig = rs('az');
      const ihr = instantHR(r);
      const br = bsig ? breathing(bsig, FS, r.t, ihr, bsnd && bsnd.t) : null;
      const artifactS = Math.max(...envs.map(e => e.artifact));
      const cons = consistency(main.bp, beats, FS, 0.15, 0.45);
      const brHR = breathFromHR(ihr);
      mot = { p, r, tp, br, brHR, comb, dur, artifactS, mainCh: main.k, ihr, cons };
      res.quality.motion = round(mot.cons, 2);
      res.quality.breath = br ? round(br.q, 2) : null;
      res.durationS = round(dur, 1);
      if (artifactS >= 5) res.notes.push(`Movement spoiled about ${artifactS} s of the recording.`);
    }
    if (rec.audio && rec.audio.samples && rec.audio.samples.length > rec.audio.sr * 10) {
      const ae = audioEnvelope(rec.audio.samples, rec.audio.sr);
      const p = period(ae.env, Math.round(0.33 * FS), Math.round(1.6 * FS));
      const beats = Number.isFinite(p.lag) ? detectBeats(ae.env, FS, p.lag) : [];
      const r = rhythm(beats, FS, ae.env.length / FS, beats.map(i => subPeak(ae.env, i)));
      const hs = beats.length > 5 ? heartSounds(ae.sharp, beats, p.lag) : null;
      aud = { p, r, hs, env: ae.env, cons: consistency(ae.sharp, beats, FS, 0.15, 0.5) };
      res.quality.audio = round(aud.cons, 2);
      if (!res.durationS) res.durationS = round(ae.env.length / FS, 1);
    }
    // the iPhone microphone often misses heart sounds entirely; only use sound that found most of the beats
    if (aud) {
      const expect = (mot ? mot.r.hr : aud.r.hr) / 60 * (aud.env.length / FS);
      if (aud.r.beats < 0.6 * expect || aud.r.coverage < 0.5) { res.soundNote = 'The microphone did not pick up clear heart sounds, so heart rate comes from chest motion only.'; res.quality.audio = 0; aud = mot ? null : aud; }
    }
    // choose the stronger heartbeat source for rhythm metrics
    const qm = mot ? mot.cons * Math.min(1, mot.r.beats / (mot.dur * 0.6)) : -1;
    const qa = aud ? aud.cons * Math.min(1, aud.r.beats / (aud.env.length / FS * 0.6)) : -1;
    // chest motion is the more specific heartbeat signal; sound wins only when clearly better and they agree
    const disagree = mot && aud && Math.abs(mot.r.hr - aud.r.hr) > 5;
    const src = !aud ? mot : !mot ? aud : (disagree && mot.cons >= 0.45) ? mot : (qa > qm * 1.15 ? aud : mot);
    if (!src) { res.error = 'No usable sensor data was found in that recording.'; return res; }
    const r = src.r;
    res.hrSource = src === mot ? 'motion' : 'sound';
    const M = res.metrics;
    M.hr = round(r.hr, 1);
    M.hrMotion = mot ? round(mot.r.hr, 1) : null;
    M.hrSound = aud ? round(aud.r.hr, 1) : null;
    M.rmssd = round(r.rmssd, 1); M.sdnn = round(r.sdnn, 1); M.pnn50 = round(r.pnn50, 1);
    M.irregPct = round(r.irregPct, 1); M.ectopic = r.ectopic; M.pauses = r.pauses;
    M.afLike = r.afLike; M.nrmssd = round(r.nrmssd, 3); M.tpr = round(r.tpr, 2); M.rrEntropy = round(r.rrEntropy, 2);
    M.beats = r.beats; M.coverage = round(r.coverage, 2);
    if (bsnd && Number.isFinite(bsnd.br)) M.brSound = round(bsnd.br, 1);
    // chest tilt is the main breathing source; a weaker tilt signal still counts when breath sounds agree with it
    const hb = mot && mot.brHR && mot.brHR.q >= 0.4 ? mot.brHR : null;
    if (hb) { M.brHeart = round(hb.br, 1); M.brHeartQ = round(hb.q, 2); }
    const soundOk = Number.isFinite(M.brSound), tiltBr = mot && mot.br;
    const confirmed = v => (soundOk && Math.abs(v - M.brSound) <= 2) || (hb && Math.abs(v - hb.br) <= 2);
    if (tiltBr && (tiltBr.q >= 0.4 || (tiltBr.q >= 0.2 && confirmed(tiltBr.br)))) { M.br = round(tiltBr.br, 1); M.brCV = round(tiltBr.brCV, 1); M.breathPauseS = round(tiltBr.pauseS, 0); M.rsa = round(tiltBr.rsa, 1); M.brFrom = 'motion'; }
    else if (soundOk) { M.br = M.brSound; M.brFrom = 'sound'; }
    // last resort, and only for a regular rhythm: extra or chaotic beats would masquerade as breathing
    else if (hb && hb.q >= 0.45 && !r.afLike && r.ectopic < 3) { M.br = M.brHeart; M.brFrom = 'heart'; }
    if (aud && aud.hs && aud.hs.s1s2 >= 150 && aud.hs.s1s2 <= 500 && !(disagree && src === mot)) { M.s1s2 = round(aud.hs.s1s2, 0); M.s2s1 = round(aud.hs.ratio, 2); }
    if (mot) M.beatAmp = round(Math.max(...mot.tp.tpl) - Math.min(...mot.tp.tpl), 4);
    res.agree = mot && aud && mot.cons > 0.3 && aud.cons > 0.3 ? Math.abs(mot.r.hr - aud.r.hr) <= 5 : null;
    const best = Math.max(qm, qa);
    res.quality.grade = best >= 0.6 ? 'good' : best >= 0.45 ? 'fair' : 'poor';
    // compact traces for display (25 Hz) and beat-to-beat intervals in ms
    const ds = (x, f) => Array.from(decimate(x, f), v => round(v, 4));
    res.ibi = r.ibi.map(v => Math.round(v * 1000));
    res.beatT = r.t.map(v => round(v, 3));
    res.traces = {};
    if (mot) {
      res.traces.beat = ds(mot.comb, 4);
      if (mot.br) res.traces.breath = Array.from(mot.br.trace, v => round(v, 5));
      res.templates = { scg: Array.from(mot.tp.tpl, v => round(v, 5)), scgN: mot.tp.n };
    }
    if (aud) { res.traces.sound = ds(aud.env, 4); if (aud.hs && M.s1s2) { res.templates = res.templates || {}; res.templates.pcg = aud.hs.tpl.map(v => round(v, 5)); res.templates.s1 = aud.hs.s1; res.templates.s2 = aud.hs.s2; } }
    return res;
  }

  function corr(a, b) {
    const n = Math.min(a.length, b.length); if (n < 5) return NaN;
    const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n)); let s = 0, ea = 0, eb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; ea += x * x; eb += y * y; }
    return ea && eb ? s / Math.sqrt(ea * eb) : NaN;
  }
  // best correlation allowing a small time shift
  function shapeMatch(a, b, maxShift = 6) {
    let best = -1;
    for (let s = -maxShift; s <= maxShift; s++) {
      const x = [], y = [];
      for (let i = 0; i < a.length; i++) { const j = i + s; if (j >= 0 && j < b.length) { x.push(a[i]); y.push(b[j]); } }
      const c = corr(x, y); if (c > best) best = c;
    }
    return best;
  }

  // ---- simulated recording, for the demo and for testing
  function simulate(opt = {}) {
    const dur = opt.dur || 60, hr = opt.hr || 62, brpm = opt.br || 13, irregular = !!opt.irregular, seed = opt.seed || 7;
    let st = seed; const rnd = () => { st = (st * 1664525 + 1013904223) % 4294967296; return st / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const beats = []; let t = 0.4;
    while (t < dur) {
      beats.push(t);
      const resp = Math.sin(2 * Math.PI * brpm / 60 * t);
      let ibi = 60 / (hr + (opt.rsa ?? 4) * resp);
      if (irregular) ibi *= 0.65 + 0.7 * rnd();
      else if (opt.ectopic && rnd() < 0.06) { ibi *= 0.7; beats.push(t + ibi); t += ibi; ibi = 60 / hr * 1.3; }
      t += ibi * (1 + 0.01 * gauss());
    }
    // accN: accelerometer noise, m/s². 0.005 is a quiet, well-placed phone; at 0.01 motion-only beat detection starts to slip
    const accN = opt.noise ?? 0.01;
    const fs = 100, n = dur * fs, M = { t: [], ax: [], ay: [], az: [], gx: [], gy: [], gz: [], tx: [], ty: [], tz: [] };
    const burst = (dt, f, tau, a) => dt >= 0 && dt < 5 * tau ? a * Math.exp(-dt / tau) * Math.sin(2 * Math.PI * f * dt) : 0;
    let bi = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / fs + 0.003 * gauss();
      while (bi < beats.length - 1 && beats[bi + 1] <= tt) bi++;
      let scg = 0;
      for (let k = Math.max(0, bi - 1); k <= Math.min(beats.length - 1, bi + 1); k++) {
        const dt = tt - beats[k];
        scg += burst(dt - 0.03, 12, 0.035, 0.05) + burst(dt - 0.36, 16, 0.025, 0.018);
      }
      const breath = 0.012 * Math.sin(2 * Math.PI * brpm / 60 * tt) + (opt.apnea && tt > 25 && tt < 38 ? -0.012 * Math.sin(2 * Math.PI * brpm / 60 * tt) : 0);
      M.t.push(i / fs);
      M.az.push(scg + accN * gauss()); M.ax.push(0.3 * scg + accN * gauss()); M.ay.push(0.2 * scg + accN * gauss());
      M.gx.push(2.5 * scg + 0.04 * gauss()); M.gy.push(1.5 * scg + 0.04 * gauss()); M.gz.push(0.04 * gauss());
      M.tx.push(Math.sin(breath) * 9.81 + 0.002 * gauss()); M.ty.push(Math.sin(0.5 * breath) * 9.81 + 0.002 * gauss()); M.tz.push(-9.81 * Math.cos(breath));
    }
    const sr = 4000, an = dur * sr, s = new Float32Array(an);
    for (let i = 0; i < an; i++) s[i] = 0.02 * gauss();
    for (const b of beats) {
      for (const [off, f, tau, a] of [[0.02, 55, 0.018, 0.5], [0.34 - 0.0016 * (hr - 60), 85, 0.012, 0.35]]) {
        const st0 = Math.round((b + off) * sr);
        for (let k = 0; k < 0.09 * sr && st0 + k < an; k++) s[st0 + k] += a * Math.exp(-k / sr / tau) * Math.sin(2 * Math.PI * f * k / sr);
      }
    }
    return { motion: M, audio: { samples: s, sr }, truth: beats };
  }

  // quick heart rate from the last few seconds of motion, for the live view
  function quickHR(t, chans) {
    if (t.length < 300) return null;
    const t1 = t[t.length - 1], t0 = Math.max(t[0], t1 - 12);
    let best = null;
    for (const x of chans) {
      const r = resample(t, x, FS, t0, t1);
      if (r.length < 6 * FS) continue;
      const e = beatEnvelope(r, FS), p = period(e.env, Math.round(0.33 * FS), Math.round(1.6 * FS));
      if (Number.isFinite(p.lag) && (!best || p.r > best.q)) best = { hr: 60 * FS / p.lag, q: p.r };
    }
    return best;
  }

  return { analyze, rhythm, simulate, shapeMatch, quickHR, median, mean, std, FS };
})();
if (typeof module !== 'undefined') module.exports = DSP;
