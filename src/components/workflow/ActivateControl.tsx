import { LoaderCircle, Play, X } from "lucide-react";
import "./ActivateControl.css";

type ActivateControlProps = {
  isActive: boolean;
  loading: boolean;
  onToggle: () => void;
};

export const ActivateControl = ({
  isActive,
  loading,
  onToggle,
}: ActivateControlProps) => {
  const label = isActive ? "Deactivate" : "Activate";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      aria-pressed={isActive}
      aria-busy={loading || undefined}
      aria-label={label + " workflow"}
      className={`coreza-activate-control ${isActive ? "coreza-activate-control--active" : ""}`}
    >
      <span className="coreza-activate-control__icon" aria-hidden="true">
        {loading ? (
          <LoaderCircle className="h-[17px] w-[17px] animate-spin motion-reduce:animate-none" />
        ) : isActive ? (
          <X className="h-[17px] w-[17px]" />
        ) : (
          <Play className="h-[17px] w-[17px]" />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
};
