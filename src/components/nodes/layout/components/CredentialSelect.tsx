import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CredentialSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: { name: string }[];
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
                {c.name}
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
