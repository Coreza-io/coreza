import { createContext } from "react";

export interface DragSource {
  nodeId: string | null;
  handleId: string | null;
  handleType: string | null;
}

export const ConnectionDragContext = createContext<DragSource>({
  nodeId: null,
  handleId: null,
  handleType: null,
});
