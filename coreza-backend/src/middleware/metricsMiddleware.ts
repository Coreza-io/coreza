/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Request, Response, NextFunction } from 'express';
import { httpRequestsCounter, httpRequestDurationHistogram } from '../utils/metrics';

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const method = req.method;
    const status = res.statusCode.toString();
    
    // Increment request counter
    httpRequestsCounter.inc({ method, route, status });
    
    // Record request duration
    httpRequestDurationHistogram.observe({ method, route }, duration);
  });
  
  next();
};
