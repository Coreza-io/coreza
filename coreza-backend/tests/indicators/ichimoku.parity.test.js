const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function runTsx(code) {
  const scriptPath = path.join(__dirname, '.tmp.ichimoku.parity.ts');
  fs.writeFileSync(scriptPath, code, 'utf8');
  try {
    return execSync(`npx tsx ${scriptPath}`, { cwd: path.join(__dirname, '../..') }).toString();
  } finally {
    fs.unlinkSync(scriptPath);
  }
}

describe('ichimoku incremental parity vs golden', () => {
  it('matches golden outputs for sequential warmUp+update', () => {
    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/ichimoku.golden.json'), 'utf8'));
    const output = runTsx(`
      import { IndicatorService } from '../../src/nodes/logic/indicators';
      const bars:any[]=[]; let p=100;
      for(let i=0;i<200;i++){ p += Math.sin(i/7)*0.7+0.15; bars.push({time:new Date(Date.UTC(2024,0,1+i)).toISOString(),high:p+1.2,low:p-1.1,close:p}); }
      const updater = IndicatorService.createIncrementalUpdater('ichimoku', { conversion_period:9, base_period:26, leading_span_b_period:52, displacement:26 });
      const warm = updater.warmUp([]);
      let state = warm.internalState;
      const out:any[]=[];
      for (const bar of bars) { const r = updater.update(state, bar); state = r.internalState; out.push(r.value); }
      console.log(JSON.stringify(out));
    `);
    const actual = JSON.parse(output.trim());
    expect(actual).toEqual(golden);
  });
});
