import { createContext } from "react";

// Node menus share the canvas transform; other UI keeps its default body portal.
export const NodePortalContainerContext = createContext<HTMLElement | undefined>(undefined);
