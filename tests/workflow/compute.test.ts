import { describe, test, expect } from '@jest/globals';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import comparatorRoutes from '../../coreza-backend/src/routes/comparator';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Compute node and API', () => {
  test('POST /comparator/compute trims string', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: ' hello ', operator: 'trim' })
      .expect(200);
    expect(res.body).toHaveProperty('data', 'hello');
  });

  test('ControlFlowExecutor executes Compute node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'compute1',
      type: 'Compute',
      name: 'Compute',
      category: 'ControlFlow',
      values: { value: 'abc', operator: 'len' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data).toBe(3);
  });

  test('POST /comparator/compute parses key-value string to JSON', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: 'ticker:AAPL, RSI:87', operator: 'toJson' })
      .expect(200);
    
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toEqual({ ticker: 'AAPL', RSI: 87 });
  });

  test('toJson handles curly braces format', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: '{ticker:AAPL, RSI:87}', operator: 'toJson' })
      .expect(200);
    
    expect(res.body.data).toEqual({ ticker: 'AAPL', RSI: 87 });
  });

  test('POST /comparator/compute calculates average', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [10, 20, 30, 40, 50], operator: 'avg' })
      .expect(200);
    expect(res.body.data).toBe(30);
  });

  test('POST /comparator/compute calculates sum', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [5, 10, 15], operator: 'sum' })
      .expect(200);
    expect(res.body.data).toBe(30);
  });

  test('POST /comparator/compute finds max', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [3, 7, 2, 9, 1], operator: 'max' })
      .expect(200);
    expect(res.body.data).toBe(9);
  });

  test('POST /comparator/compute calculates median', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [1, 2, 3, 4, 5], operator: 'median' })
      .expect(200);
    expect(res.body.data).toBe(3);
  });


  test('POST /comparator/compute maps array with split', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({
        value: ['2024-11-13T18:27:00Z', '2024-11-13T18:29:00Z', '2024-11-13T18:40:00Z'],
        operator: 'map',
        mapSubOperation: 'split',
        arg2: 'T',
        mapIndex: '0'
      })
      .expect(200);

    expect(res.body.data).toEqual(['2024-11-13', '2024-11-13', '2024-11-13']);
  });

  test('POST /comparator/compute maps array with upper', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({
        value: ['hello', 'world'],
        operator: 'map',
        mapSubOperation: 'upper'
      })
      .expect(200);

    expect(res.body.data).toEqual(['HELLO', 'WORLD']);
  });

  test('POST /comparator/compute maps array with getProperty', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({
        value: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
        operator: 'map',
        mapSubOperation: 'getProperty',
        arg2: 'name'
      })
      .expect(200);

    expect(res.body.data).toEqual(['Alice', 'Bob']);
  });

  test('ControlFlowExecutor executes Compute node with avg', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'compute1',
      name: 'Compute',
      type: 'Compute',
      category: 'ControlFlow',
      values: { value: [10, 20, 30], operator: 'avg' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data).toBe(20);
  });

  describe('regex string operations', () => {
    const createApp = () => {
      const app = express();
      app.use(express.json());
      app.use('/comparator', comparatorRoutes);
      return app;
    };

    const compute = (body: Record<string, unknown>, status = 200) =>
      request(createApp()).post('/comparator/compute').send(body).expect(status);

    test('regexTest returns match and no-match booleans', async () => {
      const match = await compute({ value: 'Release v1.2.3', operator: 'regexTest', arg1: 'v\\d+\\.\\d+\\.\\d+' });
      const noMatch = await compute({ value: 'Release pending', operator: 'regexTest', arg1: 'v\\d+\\.\\d+\\.\\d+' });

      expect(match.body.data).toBe(true);
      expect(noMatch.body.data).toBe(false);
    });

    test('regexMatch without global flag returns capture group 1, full match fallback, or null', async () => {
      const captured = await compute({ value: 'ticker=AAPL', operator: 'regexMatch', arg1: 'ticker=([A-Z]+)' });
      const optionalFallback = await compute({ value: 'id=123', operator: 'regexMatch', arg1: '(?:ticker=([A-Z]+)|id=\\d+)' });
      const noMatch = await compute({ value: 'ticker=AAPL', operator: 'regexMatch', arg1: 'price=(\\d+)' });

      expect(captured.body.data).toBe('AAPL');
      expect(optionalFallback.body.data).toBe('id=123');
      expect(noMatch.body.data).toBeNull();
    });

    test('regexMatch with global flag returns all full matches or an empty array', async () => {
      const matches = await compute({ value: 'AAPL MSFT tsla', operator: 'regexMatch', arg1: '\\b[A-Z]{2,5}\\b', regexFlags: 'g' });
      const noMatches = await compute({ value: 'no tickers', operator: 'regexMatch', arg1: '\\b[A-Z]{2,5}\\b', regexFlags: 'g' });

      expect(matches.body.data).toEqual(['AAPL', 'MSFT']);
      expect(noMatches.body.data).toEqual([]);
    });

    test('regexMatch extracts release URL from email body', async () => {
      const emailBody = 'Hello,\n\nView this release <https://example.com/releases/2026-07-21>\nThanks';
      const res = await compute({
        value: emailBody,
        operator: 'regexMatch',
        arg1: 'View this release[\\s\\S]*?<([^>]+)>',
        regexFlags: 'i',
      });

      expect(res.body.data).toBe('https://example.com/releases/2026-07-21');
    });

    test('regexMatchAll returns normalized match entries', async () => {
      const res = await compute({ value: 'AAPL:100 MSFT TSLA:250', operator: 'regexMatchAll', arg1: '([A-Z]+)(?::(\\d+))?' });

      expect(res.body.data).toEqual([
        { match: 'AAPL:100', groups: ['AAPL', '100'], index: 0 },
        { match: 'MSFT', groups: ['MSFT', null], index: 9 },
        { match: 'TSLA:250', groups: ['TSLA', '250'], index: 14 },
      ]);
    });

    test('regexMatchAll forces global matching without user g flag', async () => {
      const res = await compute({ value: 'one two three', operator: 'regexMatchAll', arg1: '\\w+' });

      expect(res.body.data.map((entry: { match: string }) => entry.match)).toEqual(['one', 'two', 'three']);
    });

    test('regexReplace supports backrefs and global replacement', async () => {
      const backref = await compute({ value: '2026-07-21', operator: 'regexReplace', arg1: '(\\d{4})-(\\d{2})-(\\d{2})', arg2: '$2/$3/$1' });
      const global = await compute({ value: 'buy AAPL sell MSFT', operator: 'regexReplace', arg1: '\\b[A-Z]{2,5}\\b', arg2: 'TICKER', regexFlags: 'g' });

      expect(backref.body.data).toBe('07/21/2026');
      expect(global.body.data).toBe('buy TICKER sell TICKER');
    });

    test('regexSplit supports plain and capture-group split output', async () => {
      const plain = await compute({ value: 'a, b;c', operator: 'regexSplit', arg1: '[,;]\\s*' });
      const withCaptures = await compute({ value: 'a, b;c', operator: 'regexSplit', arg1: '([,;])\\s*' });

      expect(plain.body.data).toEqual(['a', 'b', 'c']);
      expect(withCaptures.body.data).toEqual(['a', ',', 'b', ';', 'c']);
    });

    test('regexExtract returns capture groups or full match fallback', async () => {
      const groups = await compute({ value: 'AAPL:100 MSFT:200', operator: 'regexExtract', arg1: '([A-Z]+):\\d+' });
      const fallback = await compute({ value: 'buy AAPL sell MSFT', operator: 'regexExtract', arg1: '\\b[A-Z]{2,5}\\b' });

      expect(groups.body.data).toEqual(['AAPL', 'MSFT']);
      expect(fallback.body.data).toEqual(['AAPL', 'MSFT']);
    });

    test('regex operations preserve empty capture groups', async () => {
      const match = await compute({ value: 'a', operator: 'regexMatch', arg1: '(a*)' });
      const extract = await compute({ value: 'bbb', operator: 'regexExtract', arg1: '(a*)' });

      expect(match.body.data).toBe('a');
      expect(extract.body.data[0]).toBe('');
    });

    test('regex operations return errors for invalid pattern, flags, duplicate flags, and empty pattern', async () => {
      await compute({ value: 'abc', operator: 'regexTest', arg1: '[' }, 400).then((res) => {
        expect(res.body.error).toContain('Invalid regex');
      });
      await compute({ value: 'abc', operator: 'regexTest', arg1: 'abc', regexFlags: 'x' }, 400).then((res) => {
        expect(res.body.error).toContain('Invalid regex flags');
      });
      await compute({ value: 'abc', operator: 'regexTest', arg1: 'abc', regexFlags: 'gg' }, 400).then((res) => {
        expect(res.body.error).toContain('duplicates');
      });
      await compute({ value: 'abc', operator: 'regexTest', arg1: '' }, 400).then((res) => {
        expect(res.body.error).toContain('Pattern (arg1) is required');
      });
    });

    test('regex operations enforce pattern and input size caps', async () => {
      await compute({ value: 'abc', operator: 'regexTest', arg1: 'a'.repeat(2049) }, 400).then((res) => {
        expect(res.body.error).toContain('Regex pattern exceeds 2 KB limit');
      });
      await compute({ value: 'a'.repeat(262145), operator: 'regexTest', arg1: 'a' }, 400).then((res) => {
        expect(res.body.error).toContain('Regex input value exceeds 256 KB limit');
      });
    });

    test('ControlFlowExecutor executes regexExtract end-to-end', async () => {
      const executor = new ControlFlowExecutor();
      const node = {
        id: 'compute-regex',
        name: 'Compute',
        type: 'Compute',
        category: 'ControlFlow',
        values: { value: 'buy AAPL sell MSFT', operator: 'regexExtract', arg1: '\\b[A-Z]{2,5}\\b' }
      } as any;
      const result = await executor.execute(node, {}, {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['AAPL', 'MSFT']);
    });
  });

});
