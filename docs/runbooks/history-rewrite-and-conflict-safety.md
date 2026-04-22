# History Rewrite And Conflict Safety Runbook

Last updated: 2026-04-22

Purpose: keep sanitized repository history from being polluted again by old branches, old clones, merge commits, local machine paths, project IDs, or personal account metadata.

## Why This Exists

This repository has had history rewritten to remove personal identifiers and local machine paths from committed files and reachable Git history.

After that kind of cleanup, a normal source conflict can reintroduce the old history if an older branch or clone is merged back into `main`. The current file tree may look clean, but old commits can become reachable again through a merge parent.

That happened on 2026-04-22:

1. `main` had previously been rewritten and force-pushed after removing sensitive patterns.
2. A later conflict was resolved by choosing `origin/main`.
3. That conflict resolution produced a merge commit that reattached an older history line.
4. Current files were clean, but `git rev-list --all` again found old project names, local paths, and personal email metadata.
5. The fix required another `git filter-repo` rewrite and `git push --force-with-lease`.

## Current Sanitized State

As of the 2026-04-22 rewrite:

- `main` was force-updated through sanitized HEAD `746125b` before this runbook was added.
- later commits should remain descendants of that sanitized history.
- current tree search returned no known sensitive pattern matches.
- local reachable Git history search returned no known sensitive pattern matches.
- commit metadata search returned no known sensitive pattern matches.
- latest commit metadata uses the GitHub noreply address configured for this repository.

Known pattern categories that must not be reintroduced:

```text
personal account email fragments
personal project IDs
old validation project IDs
local Windows user names
absolute local repository paths
machine-specific home directory paths
```

Keep concrete sensitive patterns in an untracked local file such as `.omg/sensitive-patterns.txt`. Do not commit that file.

## Safe Sync Rules

Before starting work:

```bash
git fetch origin
git status
git log --oneline --left-right --graph HEAD...origin/main
```

If there is no local work to keep, prefer resetting to the sanitized remote:

```bash
git fetch origin
git reset --hard origin/main
```

If there is local work to keep, prefer rebasing on top of the sanitized remote:

```bash
git fetch origin
git rebase origin/main
```

If the rebase conflict is unclear, stop and inspect rather than choosing a whole side:

```bash
git rebase --abort
```

## Conflict Rules

Do not resolve conflicts by blindly choosing:

- "Accept all incoming"
- "Accept all origin/main"
- "Accept all current"
- a GitHub web conflict resolution that keeps one full side without inspection

Resolve each conflicted file deliberately.

When conflict markers appear, inspect both sides and keep the sanitized/current intended content:

```text
<<<<<<< HEAD
local/current side
=======
incoming side
>>>>>>> branch
```

Be especially careful with:

- docs and runbooks containing validation records
- `PLAN.md`
- `TODO.md`
- `README.md`
- `README.en.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `CLAUDE.md`
- `src/cli/commands/project.ts`
- any file mentioning project IDs, account emails, or local paths

## Pre-Push Sanitization Checks

Run current tree search:

```powershell
$pattern = (Get-Content .omg/sensitive-patterns.txt) -join "|"
rg -n $pattern . -g "!node_modules/**" -g "!dist/**" -g "!.git/**"
```

Expected result: no output, exit code `1`.

Run reachable history search:

```powershell
$pattern = (Get-Content .omg/sensitive-patterns.txt) -join "|"
$revs = git rev-list --all
if ($revs) {
  git grep -n -E $pattern $revs -- . ':!node_modules' ':!dist'
}
```

Expected result: no output, exit code `1`.

Run commit metadata search:

```powershell
$pattern = (Get-Content .omg/sensitive-patterns.txt) -join "|"
git log --all --format="%H %an <%ae> %cn <%ce> %s" |
  Select-String -Pattern $pattern
```

Expected result: no output.

Run normal verification:

```bash
npm run typecheck
npm run build
npx vitest run
git diff --check
```

## If Sensitive History Reappears

Do not run a normal push.

Use this sequence:

1. Record current and remote HEADs:

   ```bash
   git rev-parse HEAD
   git ls-remote origin refs/heads/main
   ```

2. Create a `git filter-repo` replace file with literal replacements.

3. Include a mailmap for author/committer metadata:

   ```text
   TurnaboutHero <github-noreply-email> <old-personal-email>
   Default User <default@example.com> <old-default-email>
   ```

4. Rewrite content, messages, and metadata:

   ```bash
   git filter-repo --force --replace-text <replace-file> --replace-message <replace-file> --mailmap <mailmap-file>
   ```

5. If `filter-repo` removes `origin`, restore it:

   ```bash
   git remote add origin https://github.com/TurnaboutHero/Oh-My-Google.git
   ```

6. Re-run current tree, history, and metadata searches.

7. Re-run typecheck, build, tests, and `git diff --check`.

8. Check the remote SHA still matches the expected pre-rewrite SHA:

   ```bash
   git ls-remote origin refs/heads/main
   ```

9. Push with a lease:

   ```bash
   git push --force-with-lease=refs/heads/main:<expected-remote-sha> origin main
   ```

10. Restore upstream tracking:

    ```bash
    git fetch origin main
    git branch --set-upstream-to=origin/main main
    ```

## Clone Hygiene

After a history rewrite, old clones and old branches are risky.

If a clone has no local work to keep:

```bash
git fetch origin
git reset --hard origin/main
```

If a clone has local work to keep:

1. export the work as patches or a new branch,
2. reclone or reset to `origin/main`,
3. reapply the work on top of sanitized `main`,
4. run the sanitization checks before pushing.

Do not merge old pre-rewrite branches into `main`.
