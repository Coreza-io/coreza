/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, Search, Download } from 'lucide-react';

interface VirtualizedArrayBrowserProps {
  data: any[];
  title?: string;
  onClose: () => void;
}

export const VirtualizedArrayBrowser: React.FC<VirtualizedArrayBrowserProps> = ({ 
  data, 
  title = 'Array',
  onClose,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [jumpToIndex, setJumpToIndex] = useState('');
  
  // Filter data if search is active
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    const query = searchQuery.toLowerCase();
    return data.filter((item) => {
      const str = JSON.stringify(item).toLowerCase();
      return str.includes(query);
    });
  }, [data, searchQuery]);
  
  // Map filtered indices back to original indices
  const filteredToOriginal = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const map = new Map<number, number>();
    let filteredIndex = 0;
    data.forEach((item, originalIndex) => {
      const str = JSON.stringify(item).toLowerCase();
      if (str.includes(searchQuery.toLowerCase())) {
        map.set(filteredIndex, originalIndex);
        filteredIndex++;
      }
    });
    return map;
  }, [data, searchQuery]);
  
  const virtualizer = useVirtualizer({
    count: filteredData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });
  
  const handleJumpTo = () => {
    const index = parseInt(jumpToIndex, 10);
    if (!isNaN(index) && index >= 0 && index < data.length) {
      // If searching, find the filtered index
      if (searchQuery.trim() && filteredToOriginal) {
        // Find if this original index exists in filtered results
        for (const [fIdx, oIdx] of filteredToOriginal.entries()) {
          if (oIdx === index) {
            virtualizer.scrollToIndex(fIdx, { align: 'start' });
            return;
          }
        }
        // Index not in filtered results
        return;
      }
      virtualizer.scrollToIndex(index, { align: 'start' });
    }
  };
  
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}-${data.length}-items.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const scrollPercent = virtualizer.getTotalSize() > 0 
    ? Math.round((virtualizer.scrollOffset / virtualizer.getTotalSize()) * 100) 
    : 0;
  
  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!parentRef.current) return;
    
    const visibleCount = Math.floor(parentRef.current.clientHeight / 40);
    const pageSize = Math.max(1, visibleCount - 2); // Leave 2 items overlap for context
    
    switch (e.key) {
      case 'Home':
        e.preventDefault();
        virtualizer.scrollToIndex(0, { align: 'start' });
        break;
      case 'End':
        e.preventDefault();
        virtualizer.scrollToIndex(filteredData.length - 1, { align: 'end' });
        break;
      case 'PageUp':
        e.preventDefault();
        const currentStartUp = virtualizer.getVirtualItems()[0]?.index ?? 0;
        virtualizer.scrollToIndex(Math.max(0, currentStartUp - pageSize), { align: 'start' });
        break;
      case 'PageDown':
        e.preventDefault();
        const currentStartDown = virtualizer.getVirtualItems()[0]?.index ?? 0;
        virtualizer.scrollToIndex(Math.min(filteredData.length - 1, currentStartDown + pageSize), { align: 'start' });
        break;
      case 'ArrowUp':
        e.preventDefault();
        const currentUp = virtualizer.getVirtualItems()[0]?.index ?? 0;
        virtualizer.scrollToIndex(Math.max(0, currentUp - 1), { align: 'start' });
        break;
      case 'ArrowDown':
        e.preventDefault();
        const currentDown = virtualizer.getVirtualItems()[0]?.index ?? 0;
        virtualizer.scrollToIndex(Math.min(filteredData.length - 1, currentDown + 1), { align: 'start' });
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [virtualizer, filteredData.length, onClose]);
  
  // Attach keyboard listener
  useEffect(() => {
    const container = parentRef.current;
    if (!container) return;
    
    // Make container focusable and focus it
    container.tabIndex = 0;
    container.focus();
    
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-2">
            <ChevronLeft className="w-4 h-4" />
            <span className="text-xs">Back</span>
          </Button>
          <span className="text-xs text-muted-foreground">
            {searchQuery.trim() ? (
              <>
                {filteredData.length.toLocaleString()} of {data.length.toLocaleString()} items
              </>
            ) : (
              <>{data.length.toLocaleString()} items</>
            )}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-xs px-2">
          <Download className="w-3 h-3 mr-1" />
          Export
        </Button>
      </div>
      
      {/* Search + Jump controls */}
      <div className="flex gap-2 p-2 border-b border-border">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input 
            className="pl-7 h-7 text-xs"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          <Input 
            className="w-16 h-7 text-xs"
            placeholder="Index"
            value={jumpToIndex}
            onChange={(e) => setJumpToIndex(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJumpTo()}
          />
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleJumpTo}>
            Go
          </Button>
        </div>
      </div>
      
      {/* Virtualized list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div 
          style={{ 
            height: virtualizer.getTotalSize(), 
            width: '100%',
            position: 'relative' 
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = filteredData[virtualRow.index];
            const originalIndex = filteredToOriginal 
              ? filteredToOriginal.get(virtualRow.index) ?? virtualRow.index
              : virtualRow.index;
            
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full px-2"
                style={{ 
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)` 
                }}
              >
                <div className="h-full py-1">
                  <div className="h-full p-2 rounded bg-muted/30 hover:bg-muted/50 text-xs font-mono overflow-hidden flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0">[{originalIndex}]</span>
                    <span className="break-all line-clamp-2">
                      {typeof item === 'object' 
                        ? JSON.stringify(item).slice(0, 200) 
                        : String(item).slice(0, 200)}
                      {JSON.stringify(item).length > 200 && '...'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Footer with scroll position and keyboard hints */}
      <div className="p-2 border-t border-border text-xs text-muted-foreground text-center bg-muted/20 flex items-center justify-between">
        <span className="text-[10px] opacity-70">↑↓ scroll • PgUp/Dn • Home/End • Esc close</span>
        <span>Scroll: {scrollPercent}%</span>
      </div>
    </div>
  );
};
