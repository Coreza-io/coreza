/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { memo } from 'react';

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
    img.onload = () => {
      iconCache.set(src, img);
      resolve();
    };
    img.onerror = reject;
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
    if (!iconCache.has(src)) {
      preloadIcon(src)
        .then(() => setIsLoaded(true))
        .catch(() => setHasError(true));
    }
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
      src={src}
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