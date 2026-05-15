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
    currentValue: string
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
    if (!isVisualize || !selectedInputData)
      return { vizCandles: null, filteredIndicator: [] };

    const normalizeTime = (t: any): string | undefined => {
      if (t == null) return undefined;
      if (typeof t === "number") {
        try {
          return new Date(t).toISOString().slice(0, 10);
        } catch {
          return undefined;
        }
      }
      if (typeof t === "string") {
        // numeric-string epoch
        if (/^\d+$/.test(t)) {
          const n = Number(t);
          try {
            return new Date(n).toISOString().slice(0, 10);
          } catch {
            return undefined;
          }
        }
        return t.slice(0, 10);
      }
      return undefined;
    };

    const toDictOfArrays = (candlesArray: any) => {
      if (!Array.isArray(candlesArray)) return candlesArray;
      return candlesArray.reduce(
        (acc, c) => {
          acc.t.push(normalizeTime(c.t ?? c.time));
          acc.o.push(c.o ?? c.open);
          acc.h.push(c.h ?? c.high);
          acc.l.push(c.l ?? c.low);
          acc.c.push(c.c ?? c.close);
          acc.v.push(c.v ?? c.volume);
          return acc;
        },
        { t: [], o: [], h: [], l: [], c: [], v: [] }
      );
    };

    const firstInput = Array.isArray(selectedInputData)
      ? selectedInputData[0]
      : selectedInputData;

    // Locate bars across known shapes
    const findBars = (input: any): any[] | null => {
      if (!input) return null;
      if (Array.isArray(input?.data?.BarSeries?.[0]?.bars)) return input.data.BarSeries[0].bars;
      if (Array.isArray(input?.BarSeries?.[0]?.bars)) return input.BarSeries[0].bars;
      if (Array.isArray(input?.bars)) return input.bars;
      if (Array.isArray(input?.candles)) return input.candles;
      if (Array.isArray(input)) return input;
      return null;
    };

    let vizCandles: any = null;
    let vizIndicator = null;

    const bars = findBars(firstInput);
    if (bars) {
      vizCandles = toDictOfArrays(bars);
    } else if (firstInput?.candles && typeof firstInput.candles === "object") {
      vizCandles = firstInput.candles;
    }

    if (firstInput?.indicator) {
      vizIndicator = firstInput.indicator;
    }

    const filteredIndicator = Array.isArray(vizIndicator)
      ? vizIndicator.filter(
          (d: any) => d && d.value !== null && !isNaN(d.value)
        )
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
              if (IconComponent && typeof IconComponent === 'function') {
                return React.createElement(IconComponent, { className: "w-6 h-6" });
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
                name: definition.name,
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
                  currentValue
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
              <Label htmlFor="check-dependency" className="text-xs text-muted-foreground cursor-pointer">
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
