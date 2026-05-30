import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CircleCheck, CircleX } from "lucide-react";

interface CredentialOption {
  name: string;
  reconnect_required?: boolean;
  reconnect_recommended?: boolean;
  refresh_token_lifetime_known?: boolean;
  seconds_until_reconnect?: number;
  access_token_auto_managed?: boolean;
}

interface CredentialSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: CredentialOption[];
  isLoading?: boolean;
  onAddCredential: () => void;
  onCredentialChanged?: (value: string) => void;
  disabled?: boolean;
}

export const CredentialSelect: React.FC<CredentialSelectProps> = ({
  value,
  onChange,
  options,
  isLoading,
  onAddCredential,
  onCredentialChanged,
  disabled,
}) => {
  const handleChange = (val: string) => {
    onChange(val);
    onCredentialChanged?.(val);
  };

  const renderCredentialStatus = (credential: CredentialOption) => {
    if (credential.access_token_auto_managed !== true) return null;

    if (credential.reconnect_required) {
      return (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-destructive">
          <CircleX className="h-3 w-3" /> Reconnect required
        </span>
      );
    }

    if (credential.reconnect_recommended) {
      return (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          {credential.refresh_token_lifetime_known === false
            ? "Unknown lifetime"
            : "Reconnect recommended"}
        </span>
      );
    }

    return (
      <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleCheck className="h-3 w-3" /> Access token: auto-managed
      </span>
    );
  };

  return (
    <div className="flex gap-2 items-center">
      <Select
        value={value}
        onValueChange={handleChange}
        disabled={isLoading || disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={isLoading ? "Loading..." : "Select credential"} />
        </SelectTrigger>
        <SelectContent>
          {options.length > 0 ? (
            options.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                <span className="flex items-center">
                  <span>{c.name}</span>
                  {renderCredentialStatus(c)}
                </span>
              </SelectItem>
            ))
          ) : (
            <SelectItem value="no-creds" disabled>
              No credentials found
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        onClick={onAddCredential}
        disabled={disabled}
      >
        Add
      </Button>
    </div>
  );
};

export default CredentialSelect;
