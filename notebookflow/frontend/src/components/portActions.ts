import { createContext, useContext } from "react";

export interface PortActions {
  addInput: (nodeId: string) => void;
  removeInput: (nodeId: string) => void;
  addGroupInput: (nodeId: string) => void;
  removeGroupInput: (nodeId: string) => void;
  addGroupOutput: (nodeId: string) => void;
  removeGroupOutput: (nodeId: string) => void;
  /** Shallow-merge a patch into a node's data (annotations, text-box styling, …). */
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
}

const noop: PortActions = {
  addInput: () => {},
  removeInput: () => {},
  addGroupInput: () => {},
  removeGroupInput: () => {},
  addGroupOutput: () => {},
  removeGroupOutput: () => {},
  updateNodeData: () => {},
};

export const PortActionsContext = createContext<PortActions>(noop);

export function usePortActions(): PortActions {
  return useContext(PortActionsContext);
}
