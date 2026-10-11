import type { FieldValueMode } from "../../../../../coreza-backend/src/utils/fieldValueModes";

interface FieldValueModeSelectorProps {
  label: string;
  value: FieldValueMode;
  disabled?: boolean;
  onChange: (mode: FieldValueMode) => void;
}

export default function FieldValueModeSelector({ label, value, disabled, onChange }: FieldValueModeSelectorProps) {
  return (
    <div
      role="group"
      aria-label={`${label} value mode`}
      className="edit-field-value-mode flex shrink-0 rounded-md bg-muted p-0.5 opacity-0 pointer-events-none group-hover/value-mode:opacity-100 group-hover/value-mode:pointer-events-auto group-focus-within/value-mode:opacity-100 group-focus-within/value-mode:pointer-events-auto"
    >
      {(["fixed", "expression"] as const).map(mode => (
        <button
          type="button"
          key={mode}
          disabled={disabled}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={`rounded px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === mode ? "bg-background shadow" : "text-muted-foreground"}`}
        >
          {mode === "fixed" ? "Fixed" : "Expression"}
        </button>
      ))}
    </div>
  );
}
