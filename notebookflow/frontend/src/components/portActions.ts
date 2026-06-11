import { createContext, useContext } from "react";

export interface PortActions {
  addInput: (nodeId: string) => void;
  removeInput: (nodeId: string) => void;
}

const noop: PortActions = { addInput: () => {}, removeInput: () => {} };

export const PortActionsContext = createContext<PortActions>(noop);

export function usePortActions(): PortActions {
  return useContext(PortActionsContext);
}
