const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function runTsx(code) {
  const scriptPath = path.join(__dirname, '.tmp.sr.parity.ts');
  fs.writeFileSync(scriptPath, code, 'utf8');
  try {
    return execSync(`npx tsx ${scriptPath}`, { cwd: path.join(__dirname, '../..') }).toString();
  } finally {
    fs.unlinkSync(scriptPath);
  }
}

describe('support/resistance incremental parity vs golden', () => {
  it('matches pivot/swing/historical golden outputs', () => {
    const pivotGolden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/sr.pivot.golden.json'), 'utf8'));
    const swingGolden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/sr.swing.golden.json'), 'utf8'));
    const historicalGolden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/sr.historical.golden.json'), 'utf8'));

    const output = runTsx(`
      import { IndicatorService } from '../../src/nodes/logic/indicators';
      const bars:any[]=[]; let p=100;
      for(let i=0;i<200;i++){ p += Math.sin(i/7)*0.7+0.15; bars.push({time:new Date(Date.UTC(2024,0,1+i)).toISOString(),high:p+1.2,low:p-1.1,close:p}); }
      const run=(method:string, params:any)=>{ const u = IndicatorService.createIncrementalUpdater('support-resistance', { method, ...params}); let s=u.warmUp([]).internalState; const out:any[]=[]; for(const b of bars){ const r=u.update(s,b); s=r.internalState; out.push(r.value);} return out; };
      console.log(JSON.stringify({pivot: run('pivot',{num_levels:3}), swing: run('swing',{lookback_period:40,sensitivity:1,num_levels:3}), historical: run('historical',{lookback_period:40,num_levels:3})}));
    `);
    const actual = JSON.parse(output.trim());
    expect(actual.pivot).toEqual(pivotGolden);
    expect(actual.swing).toEqual(swingGolden);
    expect(actual.historical).toEqual(historicalGolden);
  });
});
