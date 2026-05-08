/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React from "react";

// Icon registry for easy access
export const IconRegistry = {
    // 'EMA': EMAIcon,
  // 'If': IfIcon,
  // 'Switch': SwitchIcon,
  // 'OpenAI': OpenAIIcon,
} as const;

export type IconName = keyof typeof IconRegistry;
