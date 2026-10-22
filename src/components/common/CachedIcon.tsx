/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { memo } from 'react';
import { getBundledNodeIcon } from '@/utils/bundledNodeIcons';

// Icon cache to store loaded images
const iconCache = new Map<string, HTMLImageElement>();

// Preload and cache an icon
const preloadIcon = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (iconCache.has(src)) {
      resolve();
      return;
    }

    const img = new Image();
    let triedFallback = false;
    img.onload = () => {
      iconCache.set(src, img);
      resolve();
    };
    img.onerror = () => {
      const fallback = getBundledNodeIcon(src);
      if (!fallback || triedFallback) {
        reject(new Error(`Unable to load icon: ${src}`));
        return;
      }
      triedFallback = true;
      img.src = fallback;
    };
    img.src = src;
  });
};

interface CachedIconProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}

// Memoized icon component that prevents re-renders
const CachedIcon: React.FC<CachedIconProps> = memo(({ src, alt, className, fallback }) => {
  const [isLoaded, setIsLoaded] = React.useState(iconCache.has(src));
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setHasError(false);
    setIsLoaded(iconCache.has(src));
    preloadIcon(src)
      .then(() => { if (active) setIsLoaded(true); })
      .catch(() => { if (active) setHasError(true); });
    return () => { active = false; };
  }, [src]);

  if (hasError) {
    return fallback || (
      <div className={`${className} bg-muted rounded flex items-center justify-center`}>
        <span className="text-xs">?</span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={`${className} bg-muted rounded animate-pulse`}>
        {/* Loading placeholder */}
      </div>
    );
  }

  return (
    <img
      src={iconCache.get(src)?.src ?? src}
      alt={alt}
      className={className}
      loading="eager"
      style={{ imageRendering: 'auto' }}
      draggable={false}
    />
  );
});

CachedIcon.displayName = 'CachedIcon';

export default CachedIcon;
