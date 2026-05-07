/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' 
    ? { 
        target: 'pino-pretty', 
        options: { 
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        } 
      }
    : undefined,
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err
  },
  redact: {
    paths: ['password', 'token', 'authorization', 'apiKey', 'secretKey', 'credentials.apiKey', 'credentials.secretKey'],
    remove: true
  },
  formatters: {
    level: (label) => ({ level: label })
  }
});

export function createLogger(module: string) {
  return logger.child({ module });
}

export default logger;
