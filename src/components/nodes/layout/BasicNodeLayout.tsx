/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
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

interface BasicNodeLayoutProps extends BaseNodeRenderProps {}

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

  const iconTileClass = `w-10 h-10 rounded-lg flex items-center justify-center ring-1 ${
    isDarkMode
      ? "bg-[color:var(--node-neon-color)]/12 ring-[color:var(--node-border-color)]/50 shadow-[0_0_14px_var(--node-glow-color)]"
      : "bg-muted/40 ring-border"
  }`;

  const renderIcon = () => {
    const IconComponent =
      IconRegistry[definition?.name as keyof typeof IconRegistry];

    if (IconComponent && typeof IconComponent === "function") {
      return (
        <div
          className={`${iconTileClass} text-[color:var(--node-neon-color,#22d3ee)]`}
        >
          {React.createElement(IconComponent, {
            className:
              "w-6 h-6 text-[color:var(--node-neon-color,#22d3ee)] drop-shadow-[0_0_10px_var(--node-glow-color,rgba(34,211,238,0.5))]",
          })}
        </div>
      );
    }

    return (
      <div
        className={`${iconTileClass} text-[color:var(--node-neon-color,#22d3ee)]`}
        style={
          isDarkMode
            ? {
                filter:
                  "drop-shadow(0 0 6px var(--node-glow-color, rgba(34,211,238,0.45)))",
              }
            : undefined
        }
      >
        {definition?.icon ? (
          <CachedIcon
            src={definition.icon}
            alt="Node icon"
            className="w-6 h-6"
            fallback={
              <div className="w-6 h-6 bg-transparent rounded flex items-center justify-center text-[color:var(--node-neon-color,#22d3ee)]">
                <span className="text-xs">{definition.name?.[0] || "?"}</span>
              </div>
            }
          />
        ) : (
          <span className="text-xs text-[color:var(--node-neon-color,#22d3ee)]">
            {definition?.name?.[0] || "?"}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {renderIcon()}
          <h2
            className={`font-semibold text-base flex-1 ${
              isDarkMode
                ? "text-[color:var(--node-title-color,#ffffff)]"
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
