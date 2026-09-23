import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as tauriCore from "@/platform/tauri-core";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { clearRepositoryDiscoveryCache } from "@/features/git/api/git-repo-api";
import { useGitStore } from "@/features/git/stores/git.store";
import { createFileTreeGitStatusLookup, getFileTreeEntryGitStatusDecoration } from "@/features/file-explorer/lib/file-tree-git-status";
import { workspaceRuntimeRegistry } from "../runtime/workspace-runtime-registry";
import { ensureWorkspaceGitBootstrap } from "./workspace-git-bootstrap";

const scope = { workspaceId: "workspace:bootstrap-test", root: "C:/review-repo" };
const childRepo = `${scope.root}/nested`;
const status = {
  branch: "main", ahead: 0, behind: 0,
  files: [{ path: "src/Main.java", status: "modified" as const, staged: false }],
};
let interceptStatus: ((repoPath: string) => Promise<void>) | undefined;
let discoveredRepos: string[];
const invoke = mock(async (command: string, args?: Record<string, unknown>) => {
  if (command === "git_discover_workspace_repos") {
    return { repositories: discoveredRepos.map((path) => ({ path })) };
  }
  if (command === "git_discover_repo") return args?.path;
  if (command === "git_status") {
    await interceptStatus?.(String(args?.repoPath));
    return args?.repoPath === scope.root ? status : { ...status, files: [] };
  }
  throw new Error(`Unexpected native operation: ${command}`);
});
let invokeSpy: ReturnType<typeof spyOn<typeof tauriCore, "invoke">>;

function openRuntime() {
  workspaceRuntimeRegistry.ensureWorkspace({ id: scope.workspaceId, name: "Test", path: scope.root });
  useFileSystemStore.getStore(scope.workspaceId).setState({
    rootFolderPath: scope.root,
    workspaceFolders: [{ path: scope.root, name: "Test", isPrimary: true }],
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  clearRepositoryDiscoveryCache();
  openRuntime();
  interceptStatus = undefined;
  discoveredRepos = [scope.root, childRepo];
  invoke.mockClear();
  invokeSpy = spyOn(tauriCore, "invoke").mockImplementation(invoke as typeof tauriCore.invoke);
});

afterEach(() => {
  invokeSpy.mockRestore();
  clearRepositoryDiscoveryCache();
  workspaceRuntimeRegistry.resetForTests();
});

test("concurrent startup shares one Git readiness pass and root decorations", async () => {
  const childStarted = deferred();
  const releaseChild = deferred();
  interceptStatus = async (repoPath) => {
    if (repoPath === childRepo) {
      childStarted.resolve();
      await releaseChild.promise;
    }
  };
  const first = ensureWorkspaceGitBootstrap(scope);
  const tasks: Promise<unknown>[] = [first];
  try {
    await childStarted.promise;
    const second = ensureWorkspaceGitBootstrap(scope);
    tasks.push(second);
    releaseChild.resolve();
    expect(await first).toBe("published");
    expect(await second).toBe("published");
    const snapshot = useGitStore.getStore(scope.workspaceId).getState().workspaceGitStatus!;
    expect(getFileTreeEntryGitStatusDecoration(
      { name: "Main.java", path: `${scope.root}/src/Main.java`, isDir: false },
      scope.root, createFileTreeGitStatusLookup(snapshot),
    )?.label).toBe("Modified");
    const reads = invoke.mock.calls.filter(([command]) => command === "git_status").length;
    await ensureWorkspaceGitBootstrap(scope);
    expect(invoke.mock.calls.filter(([command]) => command === "git_status")).toHaveLength(reads);
    await ensureWorkspaceGitBootstrap(scope, { refresh: true });
    expect(invoke.mock.calls.filter(([command]) => command === "git_status")).toHaveLength(reads * 2);
  } finally {
    releaseChild.resolve();
    await Promise.allSettled(tasks);
  }
}, 1000);

test("Git failure is recorded once and leaves the workspace status empty", async () => {
  interceptStatus = async () => { throw new Error("Operation timed out"); };
  const errorLog = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await ensureWorkspaceGitBootstrap(scope)).toBe("failed");
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(useGitStore.getStore(scope.workspaceId).getState().workspaceGitStatus).toBeNull();
  } finally {
    errorLog.mockRestore();
  }
});

test("a workspace without repositories skips requesting Git status", async () => {
  discoveredRepos = [];
  expect(await ensureWorkspaceGitBootstrap(scope)).toBe("published");
  expect(invoke.mock.calls.filter(([command]) => command === "git_status")).toHaveLength(0);
});

test("changing workspace folders discards pending results and allows a fresh bootstrap", async () => {
  const childStarted = deferred();
  const releaseChild = deferred();
  interceptStatus = async (repoPath) => {
    if (repoPath === childRepo) {
      childStarted.resolve();
      await releaseChild.promise;
    }
  };
  const bootstrap = ensureWorkspaceGitBootstrap(scope);
  try {
    await childStarted.promise;
    useFileSystemStore.getStore(scope.workspaceId).setState({
      workspaceFolders: [
        { path: scope.root, name: "Test", isPrimary: true },
        { path: "C:/other-repo", name: "Other", isPrimary: false },
      ],
    });
    releaseChild.resolve();
    expect(await bootstrap).toBe("superseded");
    expect(useGitStore.getStore(scope.workspaceId).getState().workspaceGitStatus).toBeNull();
    // Removing the extra folder restores the old roots on the same runtime.
    // Its superseded pass must not suppress the next bootstrap forever.
    openRuntime();
    expect(await ensureWorkspaceGitBootstrap(scope)).toBe("published");
  } finally {
    releaseChild.resolve();
    await Promise.allSettled([bootstrap]);
  }
}, 1000);

test("closing a workspace during bootstrap suppresses publication and reopening starts fresh", async () => {
  const childStarted = deferred();
  const releaseChild = deferred();
  interceptStatus = async (repoPath) => {
    if (repoPath === childRepo) {
      childStarted.resolve();
      await releaseChild.promise;
    }
  };
  const oldGitStore = useGitStore.getStore(scope.workspaceId);
  const bootstrap = ensureWorkspaceGitBootstrap(scope);
  try {
    await childStarted.promise;
    workspaceRuntimeRegistry.removeWorkspace(scope.workspaceId);
    releaseChild.resolve();
    await bootstrap;
    expect(oldGitStore.getState().workspaceGitStatus).toBeNull();
    const reads = invoke.mock.calls.filter(([command]) => command === "git_status").length;
    openRuntime();
    expect(await ensureWorkspaceGitBootstrap(scope)).toBe("published");
    expect(invoke.mock.calls.filter(([command]) => command === "git_status")).toHaveLength(reads * 2);
  } finally {
    releaseChild.resolve();
    await Promise.allSettled([bootstrap]);
  }
}, 1000);
