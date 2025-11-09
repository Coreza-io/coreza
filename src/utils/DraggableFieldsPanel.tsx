import React, { useMemo } from "react";
import { format } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

type DraggableFieldsPanelProps = {
  data: unknown;
  onDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  parentKey?: string;
  maxItems?: number;
  timezone?: string;
};

type Entry = { key: string; value: unknown };

const isObjectLike = (v: unknown): v is Record<string, unknown> | unknown[] =>
  v !== null && typeof v === "object";

// Helper to detect ISO date strings
const isISODateString = (value: any): boolean => {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(value);
};

// Helper to format dates in user's timezone
const formatDateWithTimezone = (isoString: string, timezone?: string): string => {
  try {
    const tz = timezone || 'UTC';
    const formatted = formatInTimeZone(isoString, tz, 'yyyy-MM-dd HH:mm:ss');
    return formatted;
  } catch (error) {
    console.error('Date formatting error:', error);
    return isoString;
  }
};

const toStringValue = (value: unknown, timezone?: string): string => {
  if (typeof value === "string") {
    // Format date strings with timezone
    if (isISODateString(value)) {
      return formatDateWithTimezone(value, timezone);
    }
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// Build n8n-like path segments
const buildPath = (parent: string, rawKey: string): string => {
  const isNumeric = /^\d+$/.test(rawKey);
  const needsQuote = /[^A-Za-z0-9_]/.test(rawKey);
  const seg = isNumeric ? `[${rawKey}]` : needsQuote ? `["${rawKey}"]` : rawKey;
  return parent ? `${parent}.${seg}` : seg;
};

const DraggableFieldsPanel: React.FC<DraggableFieldsPanelProps> = ({
  data,
  onDragStart,
  parentKey = "",
  maxItems = 25,
  timezone,
}) => {
  if (!isObjectLike(data)) return null;

  const isArray = Array.isArray(data);

  const entriesToShow: Entry[] = useMemo(() => {
    if (Array.isArray(data)) {
      return (data as unknown[]).slice(0, maxItems).map((item, idx) => ({
        key: String(idx),
        value: item,
      }));
    }
    return Object.entries(data as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }));
  }, [data, maxItems]);

  return (
    <div className="flex flex-col gap-2 mb-2">
      {entriesToShow.map(({ key, value }) => {
        const fullKey = buildPath(parentKey, key); // n8n-style path
        const isNestedObject = isObjectLike(value);
        const displayKey = isArray ? `[${key}]` : key;

        return (
          <div key={fullKey} className="flex flex-col ml-2">
            <div className="flex items-center gap-2">
              <div
                className="nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs cursor-pointer font-semibold w-fit text-primary transition-colors cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={(e) => {
                  const asString = toStringValue(value, timezone);
                  e.dataTransfer.setData(
                    "application/reactflow",
                    JSON.stringify({
                      type: "jsonReference",
                      keyPath: fullKey, // e.g. [0].[0].asset_id
                      value: asString,
                    })
                  );
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStart(e, fullKey, asString);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title={
                  isNestedObject ? (Array.isArray(value) ? "Array" : "Object") : toStringValue(value, timezone)
                }
              >
                {displayKey}
              </div>

              <span className={`text-xs ${isISODateString(value) ? 'font-medium text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                {isNestedObject ? (
                  <span className="font-mono text-muted-foreground/60">
                    {Array.isArray(value) ? "[...]" : "{...}"}
                  </span>
                ) : (
                  toStringValue(value, timezone)
                )}
              </span>
            </div>

            {isNestedObject && (
              <div className="ml-4">
                <DraggableFieldsPanel
                  data={value}
                  onDragStart={onDragStart}
                  parentKey={fullKey}
                  maxItems={maxItems}
                  timezone={timezone}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(DraggableFieldsPanel);
