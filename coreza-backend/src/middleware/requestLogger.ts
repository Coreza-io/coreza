/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import pinoHttp from 'pino-http';
import logger from '../utils/logger';

export const requestLogger = pinoHttp({
  logger,
  autoLogging: true,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} completed`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed`;
  }
});