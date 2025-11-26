const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 8000,
  path: '/health',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    console.log('Health check: OK');
    process.exit(0);
  } else {
    console.log(`Health check failed: ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', (error) => {
  console.log(`Health check error: ${error.message}`);
  process.exit(1);
});

req.on('timeout', () => {
  console.log('Health check timeout');
  req.destroy();
  process.exit(1);
});

req.end();