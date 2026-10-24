#!/usr/bin/env node
/**
 * OBSIDIAN Local Stdio MCP Server
 * Implements the Model Context Protocol over stdin/stdout (stdio transport)
 * using the official @modelcontextprotocol/sdk.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'obsidian-stdio-mcp-server',
    version: '1.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'host_system_metrics',
        description:
          'Returns real-time Linux kernel, CPU load average, memory utilization, and process uptime over stdio MCP.',
        inputSchema: {
          type: 'object',
          properties: {
            includeEnvSummary: {
              type: 'boolean',
              description: 'Whether to include configured OBSIDIAN_* stdio environment keys.',
            },
          },
          required: [],
        },
      },
      {
        name: 'workspace_file_digest',
        description:
          'Computes SHA-256 and byte size for a target file path inside the workstation.',
        inputSchema: {
          type: 'object',
          properties: {
            targetPath: {
              type: 'string',
              description: 'Relative or absolute path to inspect.',
            },
          },
          required: ['targetPath'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === 'host_system_metrics') {
    const obsidianEnvKeys = Object.keys(process.env)
      .filter((k) => k.startsWith('OBSIDIAN_') || k.startsWith('MCP_'))
      .reduce((acc, k) => {
        acc[k] = process.env[k];
        return acc;
      }, {});

    const payload = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptimeSeconds: Math.round(os.uptime()),
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      loadAvg: os.loadavg(),
      stdioPid: process.pid,
      ...(args.includeEnvSummary ? { configuredEnv: obsidianEnvKeys } : {}),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  if (name === 'workspace_file_digest') {
    const rawTarget = String(args.targetPath || 'package.json');
    const resolved = path.resolve(process.cwd(), rawTarget);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `File not found: ${resolved}`,
          },
        ],
      };
    }
    const buf = fs.readFileSync(resolved);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              path: resolved,
              sizeBytes: buf.length,
              sha256,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Unknown stdio MCP tool: ${name}`,
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`obsidian-stdio-mcp error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
