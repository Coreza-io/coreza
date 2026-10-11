import React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FieldWrapperProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hideLabel?: boolean;
  labelAction?: React.ReactNode;
}

export const FieldWrapper: React.FC<FieldWrapperProps> = ({
  label,
  description,
  error,
  children,
  className,
  hideLabel,
  labelAction,
}) => {
  return (
    <div className={cn("space-y-2", className)}>
      {!hideLabel && label && (
        labelAction ? (
          <div className="flex flex-wrap items-center justify-between gap-1">
            <Label>{label}</Label>
            {labelAction}
          </div>
        ) : <Label>{label}</Label>
      )}
      {children}
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
};

export default FieldWrapper;
