import { describe, expect, test } from "bun:test";
import {
  FOOTER_TRAILING_ITEM_IDS,
  SIDEBAR_ACTIVITY_ITEM_IDS,
  SIDEBAR_BOTTOM_ACTIVITY_ITEM_IDS,
  normalizeItemOrder,
  setSidebarActivityItemVisibility,
  sidebarActivityVisibilityItemIds,
} from "./item-order";

describe("footer item order", () => {
  test("keeps editor status chips on the trailing status row without Database or Git Log", () => {
    const ordered = normalizeItemOrder(["notifications"], FOOTER_TRAILING_ITEM_IDS);

    expect(ordered).not.toContain("terminal");
    expect(ordered).not.toContain("diagnostics");
    expect(ordered).not.toContain("run");
    expect(ordered).not.toContain("gitLog");
    expect(ordered).not.toContain("databases");
    expect(ordered).toContain("gitChanges");
    expect(ordered).toContain("cursor");
    expect(ordered).toContain("memory");
    expect(ordered).not.toContain("notifications");
  });
});

describe("sidebar activity order", () => {
  test("exposes the editor workbench without Maven or Run", () => {
    expect(
      sidebarActivityVisibilityItemIds({
        search: true,
        git: true,
        terminal: true,
        diagnostics: true,
      }),
    ).toEqual(["files", "git", "search", "terminal", "diagnostics", "gitLog", "settings"]);
    expect([...SIDEBAR_ACTIVITY_ITEM_IDS]).not.toContain("maven");
    expect([...SIDEBAR_ACTIVITY_ITEM_IDS]).not.toContain("run");
  });

  test("hides and restores Terminal independently", () => {
    const hidden = setSidebarActivityItemVisibility([], "terminal", false);

    expect(hidden).toEqual(["terminal"]);
    expect(setSidebarActivityItemVisibility(hidden, "terminal", true)).toEqual([]);
  });

  test("does not expose an unavailable Database placeholder", () => {
    expect([...SIDEBAR_ACTIVITY_ITEM_IDS]).not.toContain("database");
  });

  test("keeps Terminal, Diagnostics, Git Log, then Settings at the rail bottom", () => {
    expect([...SIDEBAR_BOTTOM_ACTIVITY_ITEM_IDS]).toEqual([
      "terminal",
      "diagnostics",
      "gitLog",
      "settings",
    ]);
  });

  test("drops persisted Maven and Run ids from a stored sidebar order", () => {
    expect(normalizeItemOrder(["maven", "run"], SIDEBAR_ACTIVITY_ITEM_IDS)).toEqual([
      "files",
      "git",
      "search",
      "terminal",
      "diagnostics",
      "gitLog",
      "settings",
    ]);
  });
});
