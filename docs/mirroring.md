# Maintainer mirror scope and recovery

The repository's `Sync Gitee` workflow is a one-way copy from this GitHub repository
to its matching Gitee repository. It is not part of end-user installation.

- Trigger: pushes to `main`, version tags matching `v*` (no slash), or manual dispatch on those
  refs. Deleted refs and runs in a fork are excluded by the job condition.
- Tag selection follows [GitHub's filter syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#filter-pattern-cheat-sheet):
  `*` does not match `/`. Git's wider refspec match is filtered again before pushing.
- The job fetches current GitHub `main` plus `v*` tags only, then uses explicit refspecs.
  It does not mirror other branches/tags, delete destination refs, or force-update
  divergent history. It does not copy GitHub releases, assets, issues or settings.
- Manual dispatch also copies the latest GitHub main/version refs; it is not an
  instruction to publish the selected historical workflow commit.
- The GitHub token has no permissions. The existing `GITEE_SYNC_TOKEN` repository
  secret is passed to an askpass helper only for the Gitee push, never a URL or
  command argument. It is not used for the public GitHub fetch. The job removes its
  helper and runs on an ephemeral hosted runner. No token value belongs in this repo.
- A fork owner must intentionally adapt the repository/ref guard and fixed URLs and
  separately authorize their own credential. Copying this workflow does not grant
  access to the maintainer's destination.

If the secret is missing/expired or the destination rejects a ref, the workflow fails.
Inspect sanitized job diagnostics and compare both remotes' refs. Do not automatically
rotate credentials, relax permissions or force-push to make it green. Reconcile an
intentional Gitee-only commit with the owner first, then rerun an authorized sync.
Because Git push is not atomic here, inspect **each** ref after a failed multi-ref
push; some non-conflicting refs may already have advanced. No automatic rollback is
attempted, and unrelated Gitee refs are preserved.

`test/sync-gitee.test.mjs` executes the actual shell block against disposable local
repositories, with network protocols disabled. It covers no version tags, a non-version
tag on reachable history, a slash-containing tag, excluded branches, preserved destination refs and divergent
main rejection. This is a local Git policy regression, not a live Gitee write test.
