export interface ViewportState { x: number; y: number; zoom: number }

/** Lightweight bridge so GroupNode/BoundaryNode components can call App-level callbacks. */
export const groupBridge = {
  enterGroup: (_id: string) => {},
  /** Read the current canvas viewport (registered by WorkflowCanvas). */
  getViewport: (): ViewportState => ({ x: 0, y: 0, zoom: 1 }),
  /** Restore a saved viewport without animation. */
  setViewport: (_vp: ViewportState) => {},
  /** Fit all nodes into view (used the first time a level is shown). */
  fitView: () => {},
};
