/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { memo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import NodeFieldRenderer from "@/components/nodes/layout/components/NodeFieldRenderer";
import LayoutAuthModal from "@/components/nodes/layout/components/LayoutAuthModal";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
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
  const isDarkMode = useResolvedTheme() === "dark";
  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {definition?.icon &&
            (() => {
              const IconComponent =
                IconRegistry[definition.name as keyof typeof IconRegistry];
              const iconTileClass = `w-10 h-10 rounded-lg flex items-center justify-center ring-1 ${
                isDarkMode
                  ? "bg-[color:var(--node-neon-color)]/10 ring-[color:var(--node-neon-color)]/40 shadow-[0_0_12px_var(--node-neon-color)]"
                  : "bg-muted/40 ring-border"
              }`;
              if (IconComponent && typeof IconComponent === "function") {
                return (
                  <div className={iconTileClass}>
                    {React.createElement(IconComponent, {
                      className:
                        "w-6 h-6 text-[var(--node-neon-color,#22d3ee)] drop-shadow-[0_0_10px_var(--node-neon-color,#22d3ee)]",
                    })}
                  </div>
                );
              }

              return (
                <div
                  className={iconTileClass}
                  style={
                    isDarkMode
                      ? {
                          mixBlendMode: "screen",
                          filter:
                            "drop-shadow(0 0 8px var(--node-neon-color,#22d3ee))",
                        }
                      : undefined
                  }
                >
                  <CachedIcon
                    src={definition.icon}
                    alt="Node icon"
                    className="w-6 h-6"
                    fallback={
                      <div className="w-6 h-6 bg-transparent rounded flex items-center justify-center text-[var(--node-neon-color,#22d3ee)]">
                        <span className="text-xs">
                          {definition.name?.[0] || "?"}
                        </span>
                      </div>
                    }
                  />
                </div>
              );
            })()}
          <h2
            className={`font-semibold text-base flex-1 ${
              isDarkMode
                ? "text-[color:var(--node-neon-color,#22d3ee)]"
                : "text-foreground"
            }`}
          >
            {definition?.def || definition?.name || "Node"}
          </h2>
        </div>
      </div>

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
