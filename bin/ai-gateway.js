#!/usr/bin/env node

const args = process.argv.slice(2);

// Parse CLI flags
let port = '3100';
let host = '0.0.0.0';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port':
      port = args[++i];
      break;
    case '--host':
      host = args[++i];
      break;
    case '--help':
      printHelp();
      process.exit(0);
  }
}

function printHelp() {
  const help = `
Usage: x-router [options]

Options:
  --port <number>  Port to listen on (default: 3100)
  --host <string>  Host to bind to (default: 0.0.0.0)
  --help           Show this help message

Environment Variables (required):
  INTERNAL_API_KEYS   Comma-separated API keys for /v1 routes
  ADMIN_API_KEYS      Comma-separated API keys for /admin routes

Documentation: https://github.com/daokimluc/AI-Gateway
`.trim();

  console.log(help);
}

// Validate port
const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
  process.stderr.write(`Invalid port: ${port}. Must be an integer between 1 and 65535\n`);
  process.exit(1);
}

// Check required environment variables
const requiredEnvVars = ['INTERNAL_API_KEYS', 'ADMIN_API_KEYS'];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

if (missingVars.length > 0) {
  for (const varName of missingVars) {
    process.stderr.write(`Missing required environment variable: ${varName}\n`);
  }
  process.exit(1);
}

// Set environment variables for the gateway server
process.env.PORT = String(portNum);
process.env.HOST = host;

// Start the gateway server
try {
  await import('../dist/server.js');
  console.log(`http://${host}:${portNum}`);
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${portNum} is already in use\n`);
    process.exit(1);
  }
  throw err;
}
