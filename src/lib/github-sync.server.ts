import { exec } from "child_process";
import { promisify } from "util";
import { query, queryOne } from "./db";
import { ensureSaasSchema } from "./saas-schema";

const execAsync = promisify(exec);

export interface GitSyncInfo {
  repoUrl: string;
  branch: string;
  hasToken: boolean;
  maskedToken: string | null;
  lastPushedAt: string | null;
  lastCommitHash: string | null;
  lastCommitMsg: string | null;
  currentLocalCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
  uncommittedChangesCount: number;
  uncommittedFiles: string[];
}

function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

function formatAuthenticatedRepoUrl(rawUrl: string, token: string): string {
  let cleaned = rawUrl.trim();
  // If format is owner/repo or owner/repo.git
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = `https://github.com/${cleaned.replace(/^\/+/, "")}`;
  }
  if (!cleaned.endsWith(".git")) {
    cleaned = `${cleaned}.git`;
  }

  try {
    const parsed = new URL(cleaned);
    parsed.username = token.trim();
    parsed.password = "";
    return parsed.toString();
  } catch {
    // Fallback regex replacement
    const sanitized = cleaned.replace(/^https?:\/\//, "");
    return `https://${token.trim()}@${sanitized}`;
  }
}

function sanitizeErrorMessage(msg: string, token?: string | null): string {
  if (!token) return msg;
  return msg.replaceAll(token.trim(), "[REDACTED_TOKEN]");
}

/** Fetches current git state, uncommitted changes, and database GitHub sync settings. */
export async function getGitStatusAndConfig(): Promise<GitSyncInfo> {
  await ensureSaasSchema();

  const creds = await queryOne<{
    github_repo_url: string | null;
    github_branch: string | null;
    github_token: string | null;
    github_last_pushed_at: string | null;
    github_last_commit_hash: string | null;
    github_last_commit_msg: string | null;
  }>(
    `SELECT github_repo_url, github_branch, github_token, github_last_pushed_at, github_last_commit_hash, github_last_commit_msg
     FROM public.platform_credentials WHERE id = true`,
  );

  const defaultRepoUrl =
    creds?.github_repo_url || "https://github.com/Emmanuel20code/jevishpay-subscription.git";
  const defaultBranch = creds?.github_branch || "main";

  let currentLocalCommit = null;
  let uncommittedFiles: string[] = [];

  try {
    // Ensure git repo initialized
    await execAsync("git rev-parse --is-inside-work-tree").catch(async () => {
      await execAsync(`git init -b ${defaultBranch}`);
    });

    // Check git log
    const logRes = await execAsync('git log -1 --pretty=format:"%H|%s|%an|%ad"').catch(() => null);
    if (logRes?.stdout) {
      const [hash, message, author, date] = logRes.stdout.trim().split("|");
      if (hash) {
        currentLocalCommit = {
          hash,
          message: message || "",
          author: author || "",
          date: date || "",
        };
      }
    }

    // Check status
    const statusRes = await execAsync("git status --porcelain").catch(() => null);
    if (statusRes?.stdout) {
      uncommittedFiles = statusRes.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
  } catch (err) {
    console.warn("Could not read local git details:", err);
  }

  return {
    repoUrl: defaultRepoUrl,
    branch: defaultBranch,
    hasToken: Boolean(creds?.github_token?.trim()),
    maskedToken: maskToken(creds?.github_token),
    lastPushedAt: creds?.github_last_pushed_at ?? null,
    lastCommitHash: creds?.github_last_commit_hash ?? null,
    lastCommitMsg: creds?.github_last_commit_msg ?? null,
    currentLocalCommit,
    uncommittedChangesCount: uncommittedFiles.length,
    uncommittedFiles: uncommittedFiles.slice(0, 15),
  };
}

/** Saves GitHub sync settings into platform_credentials. */
export async function saveGitConfig(input: {
  repoUrl: string;
  branch: string;
  token?: string | null;
}) {
  await ensureSaasSchema();

  const repoUrl = input.repoUrl.trim();
  const branch = input.branch.trim() || "main";
  const token = input.token ? input.token.trim() : null;

  if (token) {
    await query(
      `UPDATE public.platform_credentials 
       SET github_repo_url = $1, github_branch = $2, github_token = $3, updated_at = now() 
       WHERE id = true`,
      [repoUrl, branch, token],
    );
  } else {
    await query(
      `UPDATE public.platform_credentials 
       SET github_repo_url = $1, github_branch = $2, updated_at = now() 
       WHERE id = true`,
      [repoUrl, branch],
    );
  }

  return { ok: true };
}

/** Executes git add, commit, and push to GitHub repository. */
export async function pushApplicationToGitHub(commitMessage?: string) {
  await ensureSaasSchema();

  const creds = await queryOne<{
    github_repo_url: string | null;
    github_branch: string | null;
    github_token: string | null;
  }>(
    `SELECT github_repo_url, github_branch, github_token
     FROM public.platform_credentials WHERE id = true`,
  );

  const token = creds?.github_token?.trim();
  if (!token) {
    throw new Error(
      "GitHub Personal Access Token (PAT) is required. Please enter your GitHub Token and save settings first.",
    );
  }

  const repoUrl =
    creds?.github_repo_url?.trim() ||
    "https://github.com/Emmanuel20code/jevishpay-subscription.git";
  const branch = creds?.github_branch?.trim() || "main";

  const authenticatedUrl = formatAuthenticatedRepoUrl(repoUrl, token);

  try {
    // 1. Ensure git repo initialized
    await execAsync("git rev-parse --is-inside-work-tree").catch(async () => {
      await execAsync(`git init -b ${branch}`);
    });

    // 2. Configure Git user metadata if not configured
    await execAsync('git config user.name "JevishPay Operator"').catch(() => {});
    await execAsync('git config user.email "admin@jevishpay.com"').catch(() => {});

    // 3. Set remote origin
    await execAsync("git remote remove origin").catch(() => {});
    await execAsync(`git remote add origin "${authenticatedUrl}"`);

    // 4. Stage all files (respecting .gitignore)
    await execAsync("git add -A");

    // 5. Check if there are staged changes to commit
    const statusRes = await execAsync("git status --porcelain");
    const changes = statusRes.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const now = new Date().toISOString();
    const finalMsg =
      commitMessage?.trim() || `Update JevishPay app [Admin Push ${now.split("T")[0]}]`;

    if (changes.length > 0) {
      // Escape commit message for safe shell execution
      const sanitizedMsg = finalMsg.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${sanitizedMsg}"`);
    } else {
      // If no new files, make sure at least one commit exists
      const logCheck = await execAsync("git log -1").catch(() => null);
      if (!logCheck) {
        await execAsync(`git commit --allow-empty -m "${finalMsg.replace(/"/g, '\\"')}"`);
      }
    }

    // 6. Push to remote repository
    // Attempt standard push, or set upstream
    try {
      await execAsync(`git push -u origin ${branch}`);
    } catch (pushErr: unknown) {
      const errStr = String(pushErr);
      // If rejected because remote has changes, try pull with rebase or push with force-with-lease safely
      if (errStr.includes("fetch first") || errStr.includes("Updates were rejected")) {
        // Fetch and merge remote if available
        await execAsync(`git fetch origin ${branch}`).catch(() => {});
        await execAsync(`git push -u origin ${branch} --force-with-lease`).catch(async () => {
          await execAsync(`git push -u origin ${branch}`);
        });
      } else {
        throw pushErr;
      }
    }

    // 7. Extract pushed commit info
    const latestCommitRes = await execAsync('git log -1 --pretty=format:"%H|%s"');
    const [hash, msg] = latestCommitRes.stdout.trim().split("|");

    // 8. Update database platform_credentials record
    await query(
      `UPDATE public.platform_credentials
       SET github_last_pushed_at = now(), github_last_commit_hash = $1, github_last_commit_msg = $2
       WHERE id = true`,
      [hash || null, msg || finalMsg],
    );

    // Clean remote origin so token is not left plaintext in .git/config
    await execAsync("git remote set-url origin " + repoUrl).catch(() => {});

    return {
      ok: true,
      commitHash: hash || "latest",
      commitMsg: msg || finalMsg,
      branch,
      repoUrl,
      pushedAt: new Date().toISOString(),
      changesCount: changes.length,
    };
  } catch (err: unknown) {
    // Reset remote origin to hide token
    await execAsync("git remote set-url origin " + repoUrl).catch(() => {});

    const rawError = err instanceof Error ? err.message : String(err);
    const cleanError = sanitizeErrorMessage(rawError, token);
    console.error("[pushApplicationToGitHub] Failed to push:", cleanError);
    throw new Error(`GitHub push failed: ${cleanError}`);
  }
}
