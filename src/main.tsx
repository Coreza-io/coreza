/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { preloadIcons } from "@/utils/preloadIcons";
import App from './App.tsx'
import './index.css'

// Preload icons immediately to eliminate loading delays
preloadIcons();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
