interface WorkspaceStartupPriorityOptions {
  bootstrapGit: () => Promise<void>;
  isCurrent: () => boolean;
  onGitBootstrapError?: (error: unknown) => void;
}

interface WorkspaceGitBootstrapOptions<Value> {
  workspaceRootPaths: readonly string[];
  discoverRepositories: (workspaceRootPaths: readonly string[]) => Promise<readonly string[]>;
  loadStatus: (repoPaths: readonly string[], activeRepoPath?: string) => Promise<Value | null>;
  isCurrent: () => boolean;
  publishStatus: (status: Value | null) => void;
}

export async function bootstrapWorkspaceGit<Value>({
  workspaceRootPaths,
  discoverRepositories,
  loadStatus,
  isCurrent,
  publishStatus,
}: WorkspaceGitBootstrapOptions<Value>): Promise<"published" | "superseded"> {
  const repoPaths = await discoverRepositories(workspaceRootPaths);
  if (!isCurrent()) return "superseded";

  const status = repoPaths.length > 0
    ? await loadStatus(repoPaths, repoPaths[0])
    : null;
  if (!isCurrent()) return "superseded";

  publishStatus(status);
  return "published";
}

/// Runs the workspace Git bootstrap and reports whether the result still applies
/// to the workspace the caller activated. A Git failure is forwarded to
/// `onGitBootstrapError` instead of aborting the caller's background work.
export async function runWorkspaceGitBootstrap({
  bootstrapGit,
  isCurrent,
  onGitBootstrapError,
}: WorkspaceStartupPriorityOptions): Promise<"started" | "superseded"> {
  try {
    await bootstrapGit();
  } catch (error) {
    onGitBootstrapError?.(error);
  }
  if (!isCurrent()) return "superseded";

  return "started";
}
