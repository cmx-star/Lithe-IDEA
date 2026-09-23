import type { SplitDirection, SplitPlacement } from "../types/pane.types";

/**
 * The workbench intentionally has one editor surface. Existing callers retain
 * this safe no-op until their split-specific UI paths are retired.
 */
export function createPaneBeside(
  _paneId: string,
  _direction: SplitDirection,
  _placement: SplitPlacement = "after",
  _bufferId?: string,
  _workspaceId?: string,
): string | null {
  return null;
}
