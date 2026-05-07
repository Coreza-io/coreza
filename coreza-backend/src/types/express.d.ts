/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import "express-serve-static-core";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role?: string;
        email?: string;
      };
      userId?: string;
    }
  }
}

export {};
