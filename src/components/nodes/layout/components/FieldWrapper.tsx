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
}

export const FieldWrapper: React.FC<FieldWrapperProps> = ({
  label,
  description,
  error,
  children,
  className,
  hideLabel,
}) => {
  return (
    <div className={cn("space-y-2", className)}>
      {!hideLabel && label && <Label>{label}</Label>}
      {children}
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
};

export default FieldWrapper;
