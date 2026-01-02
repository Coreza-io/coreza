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

import React, { useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
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

    const toDictOfArrays = (candlesArray: any) => {
      if (!Array.isArray(candlesArray)) return candlesArray;
      return candlesArray.reduce(
        (acc, c) => {
          acc.t.push(c.t ? c.t.slice(0, 10) : undefined);
          acc.o.push(c.o);
          acc.h.push(c.h);
          acc.l.push(c.l);
          acc.c.push(c.c);
          acc.v.push(c.v);
          return acc;
        },
        { t: [], o: [], h: [], l: [], c: [], v: [] }
      );
    };

    const firstInput = Array.isArray(selectedInputData)
      ? selectedInputData[0]
      : selectedInputData;

    let vizCandles = null;
    let vizIndicator = null;

    if (Array.isArray(firstInput?.candles)) {
      vizCandles = toDictOfArrays(firstInput.candles);
    } else if (firstInput?.candles && typeof firstInput.candles === "object") {
      vizCandles = firstInput.candles;
    } else if (Array.isArray(firstInput)) {
      vizCandles = toDictOfArrays(firstInput);
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
