import { describe, expect, test } from "bun:test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { ProjectPaneSession } from "@/features/window/stores/session.store";
import { buildPaneLayoutFromSession } from "./workspace-pane-session";

const buffers = [
  {
    id: "license",
    type: "editor",
    path: "/workspace/LICENSE",
    name: "LICENSE",
    content: "",
    savedContent: "",
    isDirty: false,
    isPinned: false,
    isPreview: false,
    isActive: true,
    isVirtual: false,
    tokens: [],
  },
  {
    id: "eslint",
    type: "editor",
    path: "/workspace/eslint.config.mjs",
    name: "eslint.config.mjs",
    content: "",
    savedContent: "",
    isDirty: false,
    isPinned: false,
    isPreview: false,
    isActive: false,
    isVirtual: false,
    tokens: [],
  },
] satisfies PaneContent[];

describe("workspace pane session", () => {
  test("restores every editor tab into one editor surface", () => {
    const paneState: ProjectPaneSession = {
      root: {
        id: "split",
        type: "split",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          {
            id: "left-pane",
            type: "group",
            bufferPaths: ["/workspace/LICENSE"],
            activeBufferPath: "/workspace/LICENSE",
          },
          {
            id: "right-pane",
            type: "group",
            bufferPaths: ["/workspace/eslint.config.mjs"],
            activeBufferPath: "/workspace/eslint.config.mjs",
          },
        ],
      },
      bottomRoot: {
        id: "bottom-pane",
        type: "group",
        bufferPaths: [],
        activeBufferPath: null,
      },
      activePaneId: "left-pane",
      mostRecentActivePaneIds: ["left-pane", "right-pane"],
      fullscreenPaneId: "right-pane",
    };

    const layout = buildPaneLayoutFromSession(paneState, buffers);

    expect(layout.root).toEqual({
      id: "root-pane",
      type: "group",
      bufferIds: ["license", "eslint"],
      activeBufferId: "license",
      mruBufferIds: [],
      pinnedBufferIds: [],
      previewBufferId: null,
    });
    expect(layout.activePaneId).toBe("root-pane");
    expect(layout.fullscreenPaneId).toBeNull();
  });
});
