import React from "react";

interface ReferenceDropTargetProps {
  children: React.ReactNode;
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
}: ReferenceDropTargetProps): React.ReactElement {
  return (
    <div className="nodrag" {...referenceDropEventHandlers} onDrop={onDrop}>
      {children}
    </div>
  );
}
