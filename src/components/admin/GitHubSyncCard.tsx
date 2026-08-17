import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { getGitHubStatus, saveGitHubSettings, pushToGitHub } from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "";
  try {
    const d = new Date(value);
    const diff = Math.round((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

export function GitHubSyncCard() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getGitHubStatus);
  const saveConfig = useServerFn(saveGitHubSettings);
  const triggerPush = useServerFn(pushToGitHub);

  const statusQuery = useQuery({
    queryKey: ["admin-github-status"],
    queryFn: () => fetchStatus(),
  });

  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showUncommittedFiles, setShowUncommittedFiles] = useState(false);

  useEffect(() => {
    if (statusQuery.data) {
      setRepoUrl(
        statusQuery.data.repoUrl || "https://github.com/Emmanuel20code/jevishpay-subscription.git",
      );
      setBranch(statusQuery.data.branch || "main");
    }
  }, [statusQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveConfig({
        data: {
          repoUrl,
          branch,
          token: token.trim() ? token.trim() : null,
        },
      }),
    onSuccess: () => {
      toast.success("GitHub repository settings saved");
      setToken("");
      queryClient.invalidateQueries({ queryKey: ["admin-github-status"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to save GitHub settings");
    },
  });

  const pushMutation = useMutation({
    mutationFn: () =>
      triggerPush({
        data: {
          commitMessage: commitMessage.trim() || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Successfully pushed to GitHub branch: ${res.branch}!`);
      setCommitMessage("");
      queryClient.invalidateQueries({ queryKey: ["admin-github-status"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "GitHub push failed");
    },
  });

  const data = statusQuery.data;
  const isPushing = pushMutation.isPending;

  // Extract clean GitHub web link if possible
  const getRepoWebUrl = (raw: string | undefined) => {
    if (!raw) return "";
    let cleaned = raw.trim().replace(/\.git$/, "");
    if (cleaned.startsWith("git@github.com:")) {
      cleaned = `https://github.com/${cleaned.replace("git@github.com:", "")}`;
    }
    return cleaned;
  };

  const webUrl = getRepoWebUrl(data?.repoUrl);

  return (
    <section
      id="github-sync-section"
      className="max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-xs"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-foreground/10 text-foreground">
            <UploadCloud className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              GitHub Repository Sync & Push
            </h2>
            <p className="text-sm text-muted-foreground">
              Push and synchronize your latest JevishPay code changes directly to GitHub.
            </p>
          </div>
        </div>

        <Button
          id="refresh-github-status-btn"
          variant="outline"
          size="sm"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isRefetching}
          className="gap-2 h-9"
        >
          <RefreshCw className={statusQuery.isRefetching ? "size-4 animate-spin" : "size-4"} />
          <span>Status</span>
        </Button>
      </div>

      {/* Sync Status Overview Banner */}
      <div className="mt-5 rounded-xl border border-border/70 bg-muted/30 p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <span className="text-xs font-medium text-muted-foreground block">
              Target Repository
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-xs font-semibold text-foreground truncate max-w-[200px]"
                title={data?.repoUrl}
              >
                {data?.repoUrl ? data.repoUrl.replace("https://github.com/", "") : "—"}
              </span>
              {webUrl && (
                <a
                  href={webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center"
                  title="Open in GitHub"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground block">Target Branch</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <GitBranch className="size-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground font-mono">
                {data?.branch || "main"}
              </span>
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground block">Authentication</span>
            <div className="mt-0.5">
              {data?.hasToken ? (
                <Badge
                  variant="default"
                  className="text-[10px] bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                >
                  <CheckCircle2 className="mr-1 size-3" /> Token Configured
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px]">
                  <ShieldAlert className="mr-1 size-3" /> Token Missing
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Commit and Push History Details */}
        <div className="mt-4 pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <GitCommit className="size-4 text-muted-foreground" />
            <span>
              Last pushed:{" "}
              <strong className="text-foreground">{formatDate(data?.lastPushedAt)}</strong>
              {data?.lastPushedAt && (
                <span className="ml-1 opacity-75">({formatRelative(data.lastPushedAt)})</span>
              )}
            </span>
          </div>

          {data?.lastCommitHash && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] bg-background px-2 py-1 rounded border border-border/50">
              <span className="text-muted-foreground">Hash:</span>
              <span className="text-foreground font-semibold">
                {data.lastCommitHash.slice(0, 7)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Uncommitted Local Changes Banner */}
      {data && data.uncommittedChangesCount > 0 && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <FileCode className="size-4 text-primary" />
              <span>
                {data.uncommittedChangesCount} modified/uncommitted file
                {data.uncommittedChangesCount !== 1 ? "s" : ""} ready to push
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowUncommittedFiles(!showUncommittedFiles)}
              className="text-primary hover:underline font-semibold"
            >
              {showUncommittedFiles ? "Hide files" : "View files"}
            </button>
          </div>

          {showUncommittedFiles && (
            <ul className="mt-3 space-y-1 font-mono text-[11px] max-h-36 overflow-y-auto pl-6 list-disc text-muted-foreground">
              {data.uncommittedFiles.map((file, idx) => (
                <li key={idx} className="truncate">
                  {file}
                </li>
              ))}
              {data.uncommittedChangesCount > data.uncommittedFiles.length && (
                <li className="italic text-muted-foreground">
                  ...and {data.uncommittedChangesCount - data.uncommittedFiles.length} more files
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Action: Trigger Push Form */}
      <div className="mt-6 rounded-xl border border-border/80 bg-background p-5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Send className="size-4 text-primary" />
          <span>Push to GitHub Repository</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Stages all current changes, creates a signed git commit, and pushes to remote branch{" "}
          <strong className="text-foreground">{data?.branch || "main"}</strong>.
        </p>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!data?.hasToken && !token.trim()) {
              toast.error("Please configure and save your GitHub Personal Access Token first.");
              return;
            }
            pushMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="commit-msg-input" className="text-xs">
              Commit Message (Optional)
            </Label>
            <Input
              id="commit-msg-input"
              type="text"
              placeholder={`Update JevishPay app [Admin Push ${new Date().toISOString().split("T")[0]}]`}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              className="h-9 text-xs"
              disabled={isPushing}
            />
          </div>

          <Button
            id="push-to-github-btn"
            type="submit"
            disabled={isPushing || (!data?.hasToken && !token.trim())}
            className="w-full sm:w-auto gap-2"
          >
            {isPushing ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                <span>Pushing to GitHub…</span>
              </>
            ) : (
              <>
                <UploadCloud className="size-4" />
                <span>Push Code to GitHub</span>
              </>
            )}
          </Button>
        </form>
      </div>

      {/* Configuration Form */}
      <div className="mt-6 border-t border-border pt-6">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <GitPullRequest className="size-4 text-muted-foreground" />
          <span>GitHub Credentials & Repository Settings</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure your GitHub repository and Personal Access Token (requires <code>repo</code>{" "}
          scope).
        </p>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="github-repo-url" className="text-xs">
                Repository URL or Owner/Repo
              </Label>
              <Input
                id="github-repo-url"
                type="text"
                placeholder="https://github.com/Emmanuel20code/jevishpay-subscription.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="h-9 text-xs font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="github-branch" className="text-xs">
                Target Branch
              </Label>
              <Input
                id="github-branch"
                type="text"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="h-9 text-xs font-mono"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="github-token" className="text-xs">
                GitHub Personal Access Token (PAT)
              </Label>
              {data?.hasToken && (
                <span className="text-[11px] text-muted-foreground">
                  Current:{" "}
                  <span className="font-mono text-foreground font-semibold">
                    {data.maskedToken}
                  </span>
                </span>
              )}
            </div>
            <div className="relative">
              <Input
                id="github-token"
                type={showToken ? "text" : "password"}
                placeholder={
                  data?.hasToken
                    ? "Leave blank to keep existing token, or paste new token"
                    : "ghp_xxxxxxxxxxxxxxxxxxxx"
                }
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="h-9 pr-10 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Lock className="size-3 text-muted-foreground shrink-0" />
              <span>Token is stored encrypted and used only for repository synchronization.</span>
            </p>
          </div>

          <Button
            id="save-github-config-btn"
            type="submit"
            variant="outline"
            disabled={saveMutation.isPending}
            className="h-9"
          >
            {saveMutation.isPending ? "Saving Settings…" : "Save GitHub Settings"}
          </Button>
        </form>
      </div>
    </section>
  );
}
