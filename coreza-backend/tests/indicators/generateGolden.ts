import { writeFileSync } from 'fs';
import { IndicatorService } from '../../src/nodes/logic/indicators';
const bars:any[]=[]; let p=100;
for(let i=0;i<200;i++){ p += Math.sin(i/7)*0.7+0.15; bars.push({time:new Date(Date.UTC(2024,0,1+i)).toISOString(),high:p+1.2,low:p-1.1,close:p}); }
async function seq(indicator:string,params:any){ const out:any[]=[]; for(let i=0;i<bars.length;i++){ const input={...params,candle_data:JSON.stringify(bars.slice(0,i+1))}; const r:any=await IndicatorService.calculate(indicator,input); out.push(r?.data?.[0] ?? null);} return out; }
(async()=>{
 writeFileSync('tests/indicators/golden/ichimoku.golden.json', JSON.stringify(await seq('ichimoku',{conversion_period:9,base_period:26,leading_span_b_period:52,displacement:26}),null,2));
 writeFileSync('tests/indicators/golden/sr.pivot.golden.json', JSON.stringify(await seq('support-resistance',{method:'pivot',num_levels:3}),null,2));
 writeFileSync('tests/indicators/golden/sr.swing.golden.json', JSON.stringify(await seq('support-resistance',{method:'swing',lookback_period:40,sensitivity:1,num_levels:3}),null,2));
 writeFileSync('tests/indicators/golden/sr.historical.golden.json', JSON.stringify(await seq('support-resistance',{method:'historical',lookback_period:40,num_levels:3}),null,2));
})();
