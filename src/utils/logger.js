// A tiny logger. Two outputs:
//   - log file (JSON lines): a permanent audit trail of every action the agent took
//   - stderr: only when LOG_LEVEL=debug, so normal CLI output stays clean
//
// User-facing progress output is NOT the logger's job; the CLI renders that.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[config.logLevel] ?? LEVELS.info;

let fileReady = false;

function write(level, message, data) {
  const entry = { time: new Date().toISOString(), level, message, ...(data && { data }) };

  if (LEVELS[level] >= LEVELS.info && !process.env.CPP_AGENT_NO_LOG_FILE) {
    try {
      if (!fileReady) {
        fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
        fileReady = true;
      }
      fs.appendFileSync(config.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Logging must never crash the agent.
    }
  }

  if (LEVELS[level] >= minLevel && minLevel === LEVELS.debug) {
    process.stderr.write(`[${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  }
}

export const logger = {
  debug: (msg, data) => write('debug', msg, data),
  info: (msg, data) => write('info', msg, data),
  warn: (msg, data) => write('warn', msg, data),
  error: (msg, data) => write('error', msg, data),
};
