#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { depsFromEnv } from './config.js';
import { createBoundraServer } from './server.js';

try {
  const server = createBoundraServer(depsFromEnv());
  await server.connect(new StdioServerTransport());
} catch (error) {
  // stdout carries the protocol; diagnostics go to stderr.
  console.error(error instanceof Error ? error.message : 'Boundra MCP server failed to start');
  process.exitCode = 1;
}
