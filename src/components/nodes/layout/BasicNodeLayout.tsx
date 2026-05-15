/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import VisualizeCandlesSignals from "@/components/charts/VisualizeCandlesSignals";
import { useAuth } from "@/contexts/AuthContext";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import NodeFieldRenderer from "@/components/nodes/layout/components/NodeFieldRenderer";
import LayoutAuthModal from "@/components/nodes/layout/components/LayoutAuthModal";
import type { BaseNodeRenderProps } from "../BaseNode";

interface BasicNodeLayoutProps extends BaseNodeRenderProps {
  definition: any;
  fieldState: Record<string, any>;
  error: string;
  isSending: boolean;
  loadingSelect: Record<string, boolean>;
  selectOptions: Record<string, any[]>;
  showAuth: boolean;
  selectedInputData: any;
  workflowId?: string;
  nodeId?: string;
  readOnly?: boolean;
  handleChange: (key: string, value: any) => void;
  handleFieldStateBatch: (updates: Record<string, any>) => void;
  handleSubmit: (e?: React.FormEvent) => void;
  handleDrop: (
    fieldKey: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    e: React.DragEvent,
    currentValue: string,
  ) => void;
  getFieldPreview: (fieldKey: string) => string | null;
  setShowAuth: (show: boolean) => void;
  fetchCredentials: (fieldKey: string) => void;
  fetchDependentOptions: (field: any, parentValue: string) => void;
  referenceStyle: React.CSSProperties;
}

const BasicNodeLayout: React.FC<BasicNodeLayoutProps> = ({
  definition,
  fieldState,
  error,
  isSending,
  loadingSelect,
  selectOptions,
  showAuth,
  selectedInputData,
  incomingEdgeCount,
  workflowId,
  nodeId,
  readOnly,
  handleChange,
  handleFieldStateBatch,
  handleSubmit,
  handleDrop,
  getFieldPreview,
  setShowAuth,
  fetchCredentials,
  fetchDependentOptions,
  referenceStyle,
}) => {
  const { user } = useAuth();
  const isVisualize = definition?.name === "Visualize";

  const { vizCandles, filteredIndicator } = useMemo(() => {
    if (!isVisualize || !selectedInputData) {
      return { vizCandles: null, filteredIndicator: [] };
    }

    const normalizeTime = (value: any) => {
      if (value === null || value === undefined) return undefined;

      if (typeof value === "number") {
        // Supports both epoch seconds and epoch milliseconds
        const milliseconds = value < 1e12 ? value * 1000 : value;
        return new Date(milliseconds).toISOString().slice(0, 10);
      }

      if (typeof value === "string") {
        const trimmed = value.trim();

        // Numeric timestamp as string
        if (/^\d+$/.test(trimmed)) {
          const numericValue = Number(trimmed);
          const milliseconds =
            numericValue < 1e12 ? numericValue * 1000 : numericValue;
          return new Date(milliseconds).toISOString().slice(0, 10);
        }

        // ISO datetime
        if (trimmed.includes("T")) {
          return trimmed.slice(0, 10);
        }

        // Already date-like
        return trimmed;
      }

      return undefined;
    };

    const getBarValue = (bar: any, shortKey: string, longKey: string) => {
      return bar?.[shortKey] ?? bar?.[longKey];
    };

    const toDictOfArrays = (barsArray: any) => {
      if (!Array.isArray(barsArray)) return barsArray;

      return barsArray.reduce(
        (acc, bar) => {
          acc.t.push(
            normalizeTime(
              bar?.t ??
                bar?.time ??
                bar?.timestamp ??
                bar?.datetime ??
                bar?.date,
            ),
          );

          acc.o.push(getBarValue(bar, "o", "open"));
          acc.h.push(getBarValue(bar, "h", "high"));
          acc.l.push(getBarValue(bar, "l", "low"));
          acc.c.push(getBarValue(bar, "c", "close"));
          acc.v.push(getBarValue(bar, "v", "volume"));

          return acc;
        },
        { t: [], o: [], h: [], l: [], c: [], v: [] },
      );
    };

    const firstInput = Array.isArray(selectedInputData)
      ? selectedInputData[0]
      : selectedInputData;

    let vizCandles = null;
    let vizIndicator = null;

    const standardBars =
      firstInput?.data?.BarSeries?.[0]?.bars ??
      firstInput?.Data?.BarSeries?.[0]?.bars ??
      firstInput?.BarSeries?.[0]?.bars ??
      firstInput?.barSeries?.[0]?.bars;

    const fallbackBars =
      firstInput?.bars ??
      firstInput?.candles ??
      firstInput?.data?.bars ??
      firstInput?.data?.candles;

    if (Array.isArray(standardBars)) {
      vizCandles = toDictOfArrays(standardBars);
    } else if (standardBars && typeof standardBars === "object") {
      vizCandles = standardBars;
    } else if (Array.isArray(fallbackBars)) {
      vizCandles = toDictOfArrays(fallbackBars);
    } else if (fallbackBars && typeof fallbackBars === "object") {
      vizCandles = fallbackBars;
    } else if (Array.isArray(firstInput)) {
      vizCandles = toDictOfArrays(firstInput);
    }

    vizIndicator =
      firstInput?.indicator ??
      firstInput?.data?.indicator ??
      firstInput?.data?.IndicatorSeries?.[0]?.values ??
      firstInput?.IndicatorSeries?.[0]?.values ??
      null;

    const filteredIndicator = Array.isArray(vizIndicator)
      ? vizIndicator.filter((d: any) => {
          const value = d?.value ?? d?.v;

          return (
            d &&
            value !== null &&
            value !== undefined &&
            !Number.isNaN(Number(value))
          );
        })
      : [];

    return { vizCandles, filteredIndicator };
  }, [isVisualize, selectedInputData]);
  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {definition?.icon &&
            (() => {
              const IconComponent =
                IconRegistry[definition.name as keyof typeof IconRegistry];
              if (IconComponent && typeof IconComponent === "function") {
                return React.createElement(IconComponent, {
                  className: "w-6 h-6",
                });
              }

              return (
                <CachedIcon
                  src={definition.icon}
                  alt="Node icon"
                  className="w-6 h-6"
                  fallback={
                    <div className="w-6 h-6 bg-muted rounded flex items-center justify-center">
                      <span className="text-xs">
                        {definition.name?.[0] || "?"}
                      </span>
                    </div>
                  }
                />
              );
            })()}
          <h2 className="font-semibold text-base text-foreground flex-1">
            {definition?.def || definition?.name || "Node"}
          </h2>
        </div>
      </div>

      {isVisualize && (
        <div className="py-2">
          {vizCandles?.t?.length ? (
            <VisualizeCandlesSignals
              candles={vizCandles}
              indicator={{
                name:
                  (Array.isArray(selectedInputData)
                    ? selectedInputData[0]?.indicatorName ||
                      selectedInputData[0]?.data?.IndicatorSeries?.[0]?.name
                    : selectedInputData?.indicatorName ||
                      selectedInputData?.data?.IndicatorSeries?.[0]?.name) ||
                  "Indicator",
                color: "#1e40af",
                data: filteredIndicator,
              }}
            />
          ) : (
            <div className="text-gray-500 text-sm py-8 text-center">
              No candle data to visualize
            </div>
          )}
          <div className="text-xs mt-2 flex gap-4">
            <span>
              <span className="inline-block w-3 h-3 rounded-full bg-green-600 mr-1" />
              Buy
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-full bg-red-600 mr-1" />
              Sell
            </span>
          </div>
        </div>
      )}

      {!isVisualize && (
        <form className="space-y-3" onSubmit={handleSubmit}>
          {(definition.fields || []).map((f: any) => (
            <NodeFieldRenderer
              key={f.key}
              field={f}
              definition={definition}
              fieldState={fieldState}
              value={fieldState[f.key]}
              selectOptions={selectOptions}
              loadingSelect={loadingSelect}
              onChange={handleChange}
              onBatchChange={handleFieldStateBatch}
              onDrop={(fieldDef, e, currentValue) =>
                handleDrop(
                  fieldDef.key,
                  (val: string) => handleChange(fieldDef.key, val),
                  e,
                  currentValue,
                )
              }
              getPreview={getFieldPreview}
              referenceStyle={referenceStyle}
              fetchDependentOptions={fetchDependentOptions}
              setShowAuth={setShowAuth}
              workflowId={workflowId}
              nodeId={nodeId}
              userId={user?.id || ""}
              readOnly={readOnly}
            />
          ))}

          {error && (
            <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded p-2">
              {error}
            </div>
          )}

          {!readOnly && incomingEdgeCount >= 2 && (
            <div className="flex items-center justify-between pt-1">
              <Label
                htmlFor="check-dependency"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                Skip dependency check
              </Label>
              <Switch
                id="check-dependency"
                checked={Boolean(fieldState.checkDependency)}
                onCheckedChange={(checked) =>
                  handleChange("checkDependency", checked)
                }
                disabled={readOnly}
              />
            </div>
          )}

          {!readOnly && (
            <Button
              type="submit"
              className="w-full bg-success hover:bg-success/90 text-success-foreground"
              disabled={isSending}
            >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                "Run"
              )}
            </Button>
          )}
        </form>
      )}

      <LayoutAuthModal
        definition={definition}
        showAuth={showAuth}
        readOnly={readOnly}
        setShowAuth={setShowAuth}
        fetchCredentials={fetchCredentials}
        userId={user?.id || ""}
      />
    </>
  );
};

export default memo(BasicNodeLayout);
