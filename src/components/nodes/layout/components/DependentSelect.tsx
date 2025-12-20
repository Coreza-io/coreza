import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DependentSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  parentValue?: string;
  isLoading?: boolean;
  dependsOn?: string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}

export const DependentSelect: React.FC<DependentSelectProps> = ({
  value,
  onChange,
  options,
  parentValue,
  isLoading,
  dependsOn,
  placeholder,
  emptyLabel,
  disabled,
}) => {
  const hasParentValue = !!parentValue;
  const isDisabled = isLoading || !hasParentValue || disabled;

  return (
    <Select value={value} onValueChange={onChange} disabled={isDisabled}>
      <SelectTrigger className="w-full">
        <SelectValue
          placeholder={
            !hasParentValue
              ? `Select ${dependsOn || "parent"} first`
              : isLoading
              ? "Loading..."
              : placeholder || "Select option"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {options.length > 0 ? (
          options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))
        ) : (
          <SelectItem value="no-options" disabled>
            {!hasParentValue ? `Select ${dependsOn || "parent"} first` : emptyLabel || "No options found"}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
};

export default DependentSelect;
