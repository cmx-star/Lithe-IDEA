import { expect, test } from "bun:test";

test("right activity rail opens the real singleton Extensions buffer", async () => {
  const railSource = await Bun.file(new URL("./plugin-activity-rail.tsx", import.meta.url)).text();
  const layoutSource = await Bun.file(new URL("./main-layout.tsx", import.meta.url)).text();

  expect(railSource).toContain(
    "const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;",
  );
  expect(railSource).toContain('buffer.type === "extensions"');
  expect(railSource).toContain('const extensionsLabel = t("extensions.title");');
  expect(railSource).toContain("aria-pressed={isExtensionsActive}");
  expect(railSource).toContain("onClick={openExtensionsBuffer}");
  expect(railSource).not.toContain("useState");
  expect(layoutSource).toContain("<PluginActivityRail />");
});

test("right activity rail keeps Extensions and Notifications without Maven", async () => {
  const railSource = await Bun.file(new URL("./plugin-activity-rail.tsx", import.meta.url)).text();
  const transparencyStyles = await Bun.file(
    new URL("../../../styles/window-transparency.css", import.meta.url),
  ).text();

  expect(railSource).toContain(
    'className="lithe-plugin-activity-rail flex w-9.5 shrink-0 flex-col items-center rounded-r-xl border-border border-r bg-surface pt-1"',
  );
  expect(railSource).toContain('<PuzzlePieceIcon className="size-4.5" />');
  expect(railSource).toContain("<NotificationsTrigger />");
  // Java/Maven left the double-ended workbench, so the rail must not import the
  // Maven store or render a Maven button any more.
  expect(railSource).not.toContain("useMavenStore");
  expect(railSource).not.toContain("PackageIcon");
  expect(railSource).not.toContain("toggleMavenPane");
  expect(transparencyStyles).toContain(".lithe-plugin-activity-rail");
});

test("the activity rail exposes no Maven or Run entry points", async () => {
  const sidebarSource = await Bun.file(
    new URL("./sidebar/sidebar-pane-selector.tsx", import.meta.url),
  ).text();
  const mainSidebarSource = await Bun.file(
    new URL("./sidebar/main-sidebar.tsx", import.meta.url),
  ).text();

  expect(mainSidebarSource).not.toContain("hasMavenRun");
  expect(mainSidebarSource).not.toContain("toggleMavenRunPane");
  expect(mainSidebarSource).not.toContain("toggleRunPane");
  expect(sidebarSource).not.toContain('id: "maven"');
  expect(sidebarSource).not.toContain('id: "run"');
  expect(sidebarSource).not.toContain("onMavenClick");
  expect(sidebarSource).not.toContain("onRunClick");
});

test("the bottom pane hosts neither Maven nor the debugger", async () => {
  const layoutSource = await Bun.file(new URL("./main-layout.tsx", import.meta.url)).text();
  const bottomPaneSource = await Bun.file(
    new URL("./bottom-pane/bottom-pane.tsx", import.meta.url),
  ).text();

  expect(layoutSource).not.toContain("MavenPane");
  expect(layoutSource).not.toContain("closeMavenToolWindow");
  expect(layoutSource).not.toContain("initializeDebuggerEventBridge");
  expect(bottomPaneSource).not.toContain("MavenRunPane");
  expect(bottomPaneSource).not.toContain("RunPane");
  expect(bottomPaneSource).not.toContain("DebuggerView");
  expect(bottomPaneSource).not.toContain("debuggerEnabled");
});
