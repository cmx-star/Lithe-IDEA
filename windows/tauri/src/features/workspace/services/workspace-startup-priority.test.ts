import { expect, test } from "bun:test";
import { bootstrapWorkspaceGit, runWorkspaceGitBootstrap } from "./workspace-startup-priority";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test("waits for the Git bootstrap before reporting that the workspace is current", async () => {
  const gitBootstrap = deferred();
  const events: string[] = [];
  const startup = runWorkspaceGitBootstrap({
    bootstrapGit: async () => {
      events.push("git-started");
      await gitBootstrap.promise;
      events.push("git-finished");
    },
    isCurrent: () => true,
  });

  expect(events).toEqual(["git-started"]);
  gitBootstrap.resolve();

  expect(await startup).toBe("started");
  expect(events).toEqual(["git-started", "git-finished"]);
});

test("reports superseded when the workspace changes during the Git bootstrap", async () => {
  const gitBootstrap = deferred();
  let current = true;
  const startup = runWorkspaceGitBootstrap({
    bootstrapGit: () => gitBootstrap.promise,
    isCurrent: () => current,
  });

  current = false;
  gitBootstrap.resolve();

  expect(await startup).toBe("superseded");
});

test("loads every discovered repository before publishing workspace Git status", async () => {
  const events: string[] = [];
  const result = await bootstrapWorkspaceGit({
    workspaceRootPaths: ["C:/workspace"],
    discoverRepositories: async (roots) => {
      events.push(`discover:${roots.join(",")}`);
      return ["C:/workspace/api", "C:/workspace/web"];
    },
    loadStatus: async (repoPaths, activeRepoPath) => {
      events.push(`status:${repoPaths.join(",")}:${activeRepoPath}`);
      return "snapshot";
    },
    isCurrent: () => true,
    publishStatus: (status) => events.push(`publish:${status}`),
  });

  expect(result).toBe("published");
  expect(events).toEqual([
    "discover:C:/workspace",
    "status:C:/workspace/api,C:/workspace/web:C:/workspace/api",
    "publish:snapshot",
  ]);
});

test("forwards a Git failure without hiding it or aborting the caller", async () => {
  const failure = new Error("Git status timed out");
  const errors: unknown[] = [];

  const result = await runWorkspaceGitBootstrap({
    bootstrapGit: async () => {
      throw failure;
    },
    isCurrent: () => true,
    onGitBootstrapError: (error) => errors.push(error),
  });

  expect(result).toBe("started");
  expect(errors).toEqual([failure]);
});

test("tolerates a Git failure when no error handler is supplied", async () => {
  const result = await runWorkspaceGitBootstrap({
    bootstrapGit: async () => {
      throw new Error("Git status timed out");
    },
    isCurrent: () => true,
  });

  expect(result).toBe("started");
});
