import React from "react";

interface ReferenceDropTargetProps {
  children: React.ReactNode;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}

const prepareReferenceDrop = (event: React.DragEvent<HTMLElement>): void => {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
};

export const referenceDropEventHandlers = {
  onDragEnter: prepareReferenceDrop,
  onDragOver: prepareReferenceDrop,
};

export function ReferenceDropTarget({
  children,
  onDrop,
  onDragOver,
  onDragLeave,
}: ReferenceDropTargetProps): React.ReactElement {
  return (
    <div className="nodrag" {...referenceDropEventHandlers} onDragOver={onDragOver ?? prepareReferenceDrop} onDragLeave={onDragLeave} onDrop={onDrop}>
      {children}
    </div>
  );
}
