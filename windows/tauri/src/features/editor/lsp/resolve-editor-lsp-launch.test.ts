import { afterEach, expect, mock, test } from "bun:test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { resolveEditorLspLaunch } from "./resolve-editor-lsp-launch";

afterEach(() => workspaceRuntimeRegistry.resetForTests());

const getExtensionForFilePath = mock(() => undefined);
const getLspServerPath = mock((_filePath: string): string | null => null);
const getLanguageId = mock((_filePath: string): string | null => null);
const getLspServerArgs = mock(() => [] as string[]);
const getLspInitializationOptions = mock((_filePath?: string): Record<string, unknown> | undefined => undefined);

mock.module("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: {
    getExtensionForFilePath,
    getLspServerPath,
    getLanguageId,
    getLspServerArgs,
    getLspInitializationOptions,
  },
}));
mock.module("@/extensions/registry/extension-store-runtime", () => ({
  getLanguageToolConfigSet: () => undefined,
}));

const scope = { workspaceId: "workspace-a", root: "D:/work-a" };

test("a Java file no longer starts JDTLS or Maven from the editor path", async () => {
  getLspServerPath.mockImplementation(() => null);
  getLanguageId.mockImplementation(() => null);

  const launch = await resolveEditorLspLaunch("D:/work-a/src/App.java", scope);

  expect(launch).toBeNull();
  // The removed Java branch used to bypass the extension registry entirely and
  // resolve jdtls plus a Maven launch context. The editor must consult the
  // registry for every language now, so a Java file without a registered
  // server resolves to nothing instead of silently starting a Java toolchain.
  expect(getLspServerPath).toHaveBeenCalledWith("D:/work-a/src/App.java");
});

test("a registered language still resolves through the extension registry", async () => {
  getLspServerPath.mockImplementation(() => "C:/servers/rust-analyzer.exe");
  getLanguageId.mockImplementation(() => "rust");
  getLspServerArgs.mockImplementation(() => ["--stdio"]);
  getLspInitializationOptions.mockImplementation(() => ({ linkedProjects: [] }));

  const launch = await resolveEditorLspLaunch("D:/work-a/src/main.rs", scope);

  expect(launch).toEqual({
    providerId: "rust",
    languageId: "rust",
    serverPath: "C:/servers/rust-analyzer.exe",
    serverArgs: ["--stdio"],
    initializationOptions: { linkedProjects: [] },
    tools: undefined,
  });
});
