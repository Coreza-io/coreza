import { config } from 'artillery';

export = {
  config: {
    target: 'http://localhost:8000',
    phases: [
      {
        duration: 30,
        arrivalRate: 5,
        name: 'Warm up'
      },
      {
        duration: 60,
        arrivalRate: 10,
        name: 'Ramp up load'
      },
      {
        duration: 120,
        arrivalRate: 15,
        name: 'Sustained load'
      }
    ],
    payload: {
      path: './load-test-data.csv',
      fields: ['user_id', 'symbol', 'period']
    }
  },
  scenarios: [
    {
      name: 'Indicators Load Test',
      weight: 50,
      flow: [
        {
          post: {
            url: '/api/indicators/rsi',
            json: {
              prices: '{{ $randomPriceArray() }}',
              period: '{{ period }}'
            }
          }
        },
        {
          think: 1
        },
        {
          post: {
            url: '/api/indicators/ema',
            json: {
              prices: '{{ $randomPriceArray() }}',
              period: 20
            }
          }
        }
      ]
    },
    {
      name: 'Workflow Execution Load Test',
      weight: 30,
      flow: [
        {
          post: {
            url: '/api/workflow/{{ user_id }}/test-workflow-id/execute',
            json: {
              input_data: {
                symbol: '{{ symbol }}',
                test: true
              }
            }
          }
        },
        {
          think: 2
        },
        {
          get: {
            url: '/api/workflow/{{ user_id }}'
          }
        }
      ]
    },
    {
      name: 'Market Data Load Test',
      weight: 20,
      flow: [
        {
          post: {
            url: '/api/market/quote',
            json: {
              symbol: '{{ symbol }}',
              exchange: 'NASDAQ'
            }
          }
        }
      ]
    }
  ]
};