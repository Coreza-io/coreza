const fs = require('fs');
const path = require('path');

describe('incremental updater registration', () => {
  it('registers ichimoku and support-resistance in createIncrementalUpdater switch', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/nodes/logic/indicators.ts'), 'utf8');
    expect(source.includes('case "ichimoku"')).toBe(true);
    expect(source.includes('case "support-resistance"')).toBe(true);
  });
});
