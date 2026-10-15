const D=require('../src/analysis.js');
for (const o of [{hr:62,br:13},{hr:75,br:16,seed:3},{hr:90,br:18,seed:5},{hr:55,br:10,seed:9},{hr:70,irregular:true},{hr:64,ectopic:true,seed:11},{hr:60,br:12,apnea:true}]) {
  const t=Date.now(); const r=D.analyze(D.simulate(o));
  console.log(JSON.stringify(o), Date.now()-t+'ms', JSON.stringify(r.metrics), JSON.stringify(r.quality), r.hrSource, r.agree);
}
// motion only, no audio; audio only
const s=D.simulate({hr:68}); console.log('motion-only',JSON.stringify(D.analyze({motion:s.motion}).metrics));
console.log('audio-only',JSON.stringify(D.analyze({audio:s.audio}).metrics));
const s2={...s.motion}; delete s2.tx; delete s2.ty; delete s2.tz; console.log('no gravity',JSON.stringify(D.analyze({motion:s2}).metrics));
