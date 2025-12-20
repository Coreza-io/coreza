import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getOperatorDisplay,
  type GroupedOptionType,
} from "@/components/nodes/layouts/utils/operators";

interface GroupedSelectProps {
  value?: string;
  onChange: (value: string) => void;
  groupedOptions?: Record<string, GroupedOptionType>;
  placeholder?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

export const GroupedSelect: React.FC<GroupedSelectProps> = ({
  value,
  onChange,
  groupedOptions,
  placeholder,
  triggerClassName,
  disabled,
}) => {
  const operatorDisplay = groupedOptions
    ? getOperatorDisplay(value ?? "", groupedOptions)
    : null;

  if (!groupedOptions) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-between text-sm h-9", triggerClassName)}
          disabled={disabled}
        >
          <span className="flex items-center gap-2 truncate">
            <span className="text-primary font-medium">
              {operatorDisplay?.icon ?? "?"}
            </span>
            <span className="truncate">
              {operatorDisplay?.label ?? placeholder ?? "Select operation"}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {Object.entries(groupedOptions).map(([typeKey, typeData]) => (
          <DropdownMenuSub key={typeKey}>
            <DropdownMenuSubTrigger>
              <span className="text-primary mr-2">{typeData.icon}</span>
              {typeData.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {typeData.options.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => onChange(opt.value)}
                  className={
                    value === opt.value
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default GroupedSelect;
