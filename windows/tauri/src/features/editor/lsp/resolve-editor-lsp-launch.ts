import type { BackendLanguageToolConfigSet } from "@/extensions/registry/extension-store-runtime";
import type { JavaLspRuntime, JdtlsLaunchResources } from "./java-lsp-host-api";
import type { MavenLaunchContext } from "@/features/maven/types/maven.types";
import type { WorkspaceLaunchScope } from "@/features/workspace/types/workspace-launch-scope";

export interface EditorLspLaunch {
  providerId: string;
  languageId: string;
  serverPath: string;
  serverArgs: string[];
  initializationOptions?: Record<string, unknown>;
  tools?: BackendLanguageToolConfigSet;
  runtimeExecutablePath?: string | null;
  jdtlsLaunchResources?: JdtlsLaunchResources | null;
  cacheDirectory?: string;
  environment?: Record<string, string>;
  /** Workspace structure digest forwarded to the Rust core. */
  workspaceFingerprint?: string | null;
  mavenContext?: MavenLaunchContext | null;
  javaRuntimes?: JavaLspRuntime[];
}

export async function resolveEditorLspLaunch(
  filePath: string,
  _scope: WorkspaceLaunchScope,
): Promise<EditorLspLaunch | null> {
  const [{ extensionRegistry }, { getLanguageToolConfigSet }] = await Promise.all([
    import("@/extensions/registry/extension-registry"),
    import("@/extensions/registry/extension-store-runtime"),
  ]);
  const extension = extensionRegistry.getExtensionForFilePath(filePath);
  const serverPath = extensionRegistry.getLspServerPath(filePath);
  const languageId = extensionRegistry.getLanguageId(filePath);
  if (!serverPath || !languageId) return null;

  return {
    providerId: languageId,
    languageId,
    serverPath,
    serverArgs: extensionRegistry.getLspServerArgs(filePath),
    initializationOptions: extensionRegistry.getLspInitializationOptions(filePath),
    tools: getLanguageToolConfigSet(extension?.manifest),
  };
}
