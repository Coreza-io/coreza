export type GroupedOptionType = {
  icon: string;
  label: string;
  options: { label: string; value: string }[];
};

// Generate display metadata for grouped operator options
export const getOperatorDisplay = (
  operatorValue: string,
  groupedOptions: Record<string, GroupedOptionType>
) => {
  for (const [, typeData] of Object.entries(groupedOptions)) {
    const option = typeData.options.find((opt) => opt.value === operatorValue);
    if (option) {
      return { icon: typeData.icon, label: option.label, type: typeData.label };
    }
  }
  return { icon: "?", label: operatorValue, type: "Unknown" };
};

export const OPERATORS_WITHOUT_RIGHT_VALUE = new Set([
  "exists",
  "not_exists",
  "is_empty",
  "is_not_empty",
  "is_true",
  "is_false",
  "array_is_empty",
  "array_is_not_empty",
  "object_is_empty",
  "object_is_not_empty",
  "isNull",
  "is_not_null",
]);

export const operatorRequiresRightValue = (operator?: string) =>
  operator ? !OPERATORS_WITHOUT_RIGHT_VALUE.has(operator) : true;
