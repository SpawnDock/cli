import type { TemplateConfig } from "../domain.js"

const renderEntrypointAutoUpdate = (): string =>
  `# 1) Keep Codex CLI up to date if requested (bun only)
if [[ "$CODEX_AUTO_UPDATE" == "1" ]]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[codex] updating via bun..."
    BUN_INSTALL=/usr/local/bun script -q -e -c "bun add -g @openai/codex@latest" /dev/null || true
  else
    echo "[codex] bun not found, skipping auto-update"
  fi
fi`

const renderClonePreamble = (): string =>
  `# 2) Auto-clone repo if not already present
mkdir -p /run/docker-git
CLONE_DONE_PATH="/run/docker-git/clone.done"
CLONE_FAIL_PATH="/run/docker-git/clone.failed"
rm -f "$CLONE_DONE_PATH" "$CLONE_FAIL_PATH"

CLONE_OK=1`

const renderCloneRemotes = (config: TemplateConfig): string =>
  `if [[ "$CLONE_OK" -eq 1 && -d "$TARGET_DIR/.git" ]]; then
  if [[ -n "$FORK_REPO_URL" && "$FORK_REPO_URL" != "$REPO_URL" ]]; then
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote set-url origin '$FORK_REPO_URL'" || true
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote add upstream '$REPO_URL' 2>/dev/null || git remote set-url upstream '$REPO_URL'" || true
  else
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote set-url origin '$REPO_URL'" || true
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote remove upstream >/dev/null 2>&1 || true" || true
  fi
fi`

const renderCloneGuard = (config: TemplateConfig): string =>
  `if [[ -z "$REPO_URL" ]]; then
  echo "[clone] skip (no repo url)"
elif [[ -d "$TARGET_DIR/.git" ]]; then
  echo "[clone] skip (already cloned)"
else
  mkdir -p "$TARGET_DIR"
  if [[ "$TARGET_DIR" != "/" ]]; then
    chown -R 1000:1000 "$TARGET_DIR"
  fi
  chown -R 1000:1000 /home/${config.sshUser}`

const renderCloneAuthSelection = (): string =>
  `  RESOLVED_GIT_AUTH_USER="$GIT_AUTH_USER"
  RESOLVED_GIT_AUTH_TOKEN="$GIT_AUTH_TOKEN"
  RESOLVED_GIT_AUTH_LABEL=""
  GIT_TOKEN_LABEL_RAW="\${GIT_AUTH_LABEL:-\${GITHUB_AUTH_LABEL:-}}"

  if [[ -z "$GIT_TOKEN_LABEL_RAW" && "$REPO_URL" == https://github.com/* ]]; then
    GIT_TOKEN_LABEL_RAW="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##' | cut -d/ -f1)"
  fi

  if [[ -n "$GIT_TOKEN_LABEL_RAW" ]]; then
    RESOLVED_GIT_AUTH_LABEL="$(printf "%s" "$GIT_TOKEN_LABEL_RAW" | tr '[:lower:]' '[:upper:]' | sed -E 's/[^A-Z0-9]+/_/g; s/^_+//; s/_+$//')"
    if [[ "$RESOLVED_GIT_AUTH_LABEL" == "DEFAULT" ]]; then
      RESOLVED_GIT_AUTH_LABEL=""
    fi
  fi

  if [[ -n "$RESOLVED_GIT_AUTH_LABEL" ]]; then
    LABELED_GIT_TOKEN_KEY="GIT_AUTH_TOKEN__$RESOLVED_GIT_AUTH_LABEL"
    LABELED_GITHUB_TOKEN_KEY="GITHUB_TOKEN__$RESOLVED_GIT_AUTH_LABEL"
    LABELED_GIT_USER_KEY="GIT_AUTH_USER__$RESOLVED_GIT_AUTH_LABEL"

    LABELED_GIT_TOKEN="\${!LABELED_GIT_TOKEN_KEY-}"
    LABELED_GITHUB_TOKEN="\${!LABELED_GITHUB_TOKEN_KEY-}"
    LABELED_GIT_USER="\${!LABELED_GIT_USER_KEY-}"

    if [[ -n "$LABELED_GIT_TOKEN" ]]; then
      RESOLVED_GIT_AUTH_TOKEN="$LABELED_GIT_TOKEN"
    elif [[ -n "$LABELED_GITHUB_TOKEN" ]]; then
      RESOLVED_GIT_AUTH_TOKEN="$LABELED_GITHUB_TOKEN"
    fi

    if [[ -n "$LABELED_GIT_USER" ]]; then
      RESOLVED_GIT_AUTH_USER="$LABELED_GIT_USER"
    fi
  fi`

const renderCloneAuthRepoUrl = (): string =>
  `  AUTH_REPO_URL="$REPO_URL"
  if [[ -n "$RESOLVED_GIT_AUTH_TOKEN" && "$REPO_URL" == https://* ]]; then
    AUTH_REPO_URL="$(printf "%s" "$REPO_URL" | sed "s#^https://#https://\${RESOLVED_GIT_AUTH_USER}:\${RESOLVED_GIT_AUTH_TOKEN}@#")"
  fi`

const renderCloneCacheInit = (config: TemplateConfig): string =>
  `  CLONE_CACHE_ARGS=""
  CACHE_REPO_DIR=""
  CACHE_ROOT="/home/${config.sshUser}/.docker-git/.cache/git-mirrors"
  if command -v sha256sum >/dev/null 2>&1; then
    REPO_CACHE_KEY="$(printf "%s" "$REPO_URL" | sha256sum | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    REPO_CACHE_KEY="$(printf "%s" "$REPO_URL" | shasum -a 256 | awk '{print $1}')"
  else
    REPO_CACHE_KEY="$(printf "%s" "$REPO_URL" | tr '/:@' '_' | tr -cd '[:alnum:]_.-')"
  fi

  if [[ -n "$REPO_CACHE_KEY" ]]; then
    CACHE_REPO_DIR="$CACHE_ROOT/$REPO_CACHE_KEY.git"
    mkdir -p "$CACHE_ROOT"
    chown 1000:1000 "$CACHE_ROOT" || true
    if [[ -d "$CACHE_REPO_DIR" ]]; then
      if su - ${config.sshUser} -c "git --git-dir '$CACHE_REPO_DIR' rev-parse --is-bare-repository >/dev/null 2>&1"; then
        if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git --git-dir '$CACHE_REPO_DIR' fetch --progress --prune '$AUTH_REPO_URL' '+refs/*:refs/*'"; then
          echo "[clone-cache] mirror refresh failed for $REPO_URL"
        fi
        CLONE_CACHE_ARGS="--reference-if-able '$CACHE_REPO_DIR' --dissociate"
        echo "[clone-cache] using mirror: $CACHE_REPO_DIR"
      else
        echo "[clone-cache] invalid mirror removed: $CACHE_REPO_DIR"
        rm -rf "$CACHE_REPO_DIR"
      fi
    fi
  fi`

const renderCloneBodyStart = (config: TemplateConfig): string =>
  [
    renderCloneGuard(config),
    renderCloneAuthSelection(),
    renderCloneAuthRepoUrl(),
    renderCloneCacheInit(config)
  ].join("\n\n")

const renderCloneBodyRef = (config: TemplateConfig): string =>
  `  if [[ -n "$REPO_REF" ]]; then
    if [[ "$REPO_REF" == refs/pull/* ]]; then
      REF_BRANCH="pr-$(printf "%s" "$REPO_REF" | tr '/:' '--')"
      if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        echo "[clone] git clone failed for $REPO_URL"
        CLONE_OK=0
      else
        if ! su - ${config.sshUser} -c "cd '$TARGET_DIR' && GIT_TERMINAL_PROMPT=0 git fetch --progress origin '$REPO_REF':'$REF_BRANCH' && git checkout '$REF_BRANCH'"; then
          echo "[clone] git fetch failed for $REPO_REF"
          CLONE_OK=0
        fi
      fi
    else
      if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS --branch '$REPO_REF' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        echo "[clone] branch '$REPO_REF' missing; retrying without --branch"
        if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS '$AUTH_REPO_URL' '$TARGET_DIR'"; then
          echo "[clone] git clone failed for $REPO_URL"
          CLONE_OK=0
        elif [[ "$REPO_REF" == issue-* ]]; then
          if ! su - ${config.sshUser} -c "cd '$TARGET_DIR' && git checkout -B '$REPO_REF'"; then
            echo "[clone] failed to create local branch '$REPO_REF'"
            CLONE_OK=0
          fi
        fi
      fi
    fi
  else
    if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS '$AUTH_REPO_URL' '$TARGET_DIR'"; then
      echo "[clone] git clone failed for $REPO_URL"
      CLONE_OK=0
    fi
  fi`

const renderCloneCacheFinalize = (config: TemplateConfig): string =>
  `CACHE_REPO_DIR="\${CACHE_REPO_DIR:-}"
if [[ "$CLONE_OK" -eq 1 && -d "$TARGET_DIR/.git" && -n "$CACHE_REPO_DIR" && ! -d "$CACHE_REPO_DIR" ]]; then
  CACHE_TMP_DIR="$CACHE_REPO_DIR.tmp-$$"
  if su - ${config.sshUser} -c "rm -rf '$CACHE_TMP_DIR' && GIT_TERMINAL_PROMPT=0 git clone --mirror --progress '$TARGET_DIR/.git' '$CACHE_TMP_DIR'"; then
    if mv "$CACHE_TMP_DIR" "$CACHE_REPO_DIR" 2>/dev/null; then
      echo "[clone-cache] mirror created: $CACHE_REPO_DIR"
    else
      rm -rf "$CACHE_TMP_DIR"
    fi
  else
    echo "[clone-cache] mirror bootstrap failed for $REPO_URL"
    rm -rf "$CACHE_TMP_DIR"
  fi
fi`

const renderCloneBody = (config: TemplateConfig): string =>
  [
    renderCloneBodyStart(config),
    renderCloneBodyRef(config),
    "fi",
    "",
    renderCloneRemotes(config),
    "",
    renderCloneCacheFinalize(config)
  ].join("\n")

const renderCloneFinalize = (): string =>
  `if [[ "$CLONE_OK" -eq 1 ]]; then
  echo "[clone] done"
  touch "$CLONE_DONE_PATH"
else
  echo "[clone] failed"
  touch "$CLONE_FAIL_PATH"
fi`

const renderEntrypointClone = (config: TemplateConfig): string =>
  [renderClonePreamble(), renderCloneBody(config), renderCloneFinalize()].join("\n\n")

const renderAgentPrompt = (): string =>
  `  AGENT_PROMPT=""
  ISSUE_NUM=""
  if [[ "$REPO_REF" =~ ^issue-([0-9]+)$ ]]; then
    ISSUE_NUM="\${BASH_REMATCH[1]}"
  fi

  if [[ "$AGENT_AUTO" == "1" ]]; then
    if [[ -n "$ISSUE_NUM" ]]; then
      AGENT_PROMPT="Read GitHub issue #$ISSUE_NUM for this repository (use gh issue view $ISSUE_NUM). Implement the requested changes, commit them, create a PR that closes #$ISSUE_NUM, and push it."
    else
      AGENT_PROMPT="Analyze this repository, implement any pending tasks, commit changes, create a PR, and push it."
    fi
  fi`

const renderAgentLaunch = (config: TemplateConfig): string =>
  `# 3) Auto-launch agent if AGENT_MODE is set
if [[ "$CLONE_OK" -eq 1 && -n "$AGENT_MODE" ]]; then
  AGENT_DONE_PATH="/run/docker-git/agent.done"
  AGENT_FAIL_PATH="/run/docker-git/agent.failed"
  AGENT_PROMPT_FILE="/run/docker-git/agent-prompt.txt"
  rm -f "$AGENT_DONE_PATH" "$AGENT_FAIL_PATH" "$AGENT_PROMPT_FILE"

  # Collect tokens for agent environment (su - dev does not always inherit profile.d)
  AGENT_ENV_FILE="/run/docker-git/agent-env.sh"
  {
    [[ -f /etc/profile.d/gh-token.sh ]] && cat /etc/profile.d/gh-token.sh
    [[ -f /etc/profile.d/claude-config.sh ]] && cat /etc/profile.d/claude-config.sh
  } > "$AGENT_ENV_FILE" 2>/dev/null || true
  chmod 644 "$AGENT_ENV_FILE"

${renderAgentPrompt()}

  AGENT_OK=0
  if [[ -n "$AGENT_PROMPT" ]]; then
    printf "%s" "$AGENT_PROMPT" > "$AGENT_PROMPT_FILE"
    chmod 644 "$AGENT_PROMPT_FILE"
  fi

  if [[ "$AGENT_MODE" == "claude" ]]; then
    echo "[agent] starting claude..."
    if [[ -n "$AGENT_PROMPT" ]]; then
      if su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && claude --dangerously-skip-permissions -p \\"\\\$(cat $AGENT_PROMPT_FILE)\\""; then
        AGENT_OK=1
      fi
    else
      echo "[agent] claude started in interactive mode (use SSH to connect)"
      AGENT_OK=1
    fi
  elif [[ "$AGENT_MODE" == "codex" ]]; then
    echo "[agent] starting codex..."
    if [[ -n "$AGENT_PROMPT" ]]; then
      if su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && codex --approval-mode full-auto \\"\\\$(cat $AGENT_PROMPT_FILE)\\""; then
        AGENT_OK=1
      fi
    else
      echo "[agent] codex started in interactive mode (use SSH to connect)"
      AGENT_OK=1
    fi
  else
    echo "[agent] unknown agent mode: $AGENT_MODE"
  fi

  if [[ "$AGENT_OK" -eq 1 && "$AGENT_AUTO" == "1" && -n "$ISSUE_NUM" ]]; then
    echo "[agent] posting review comment to issue #$ISSUE_NUM..."

    PR_BODY=""
    PR_BODY=$(su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && gh pr list --head '$REPO_REF' --json body --jq '.[0].body'" 2>/dev/null) || true

    if [[ -z "$PR_BODY" ]]; then
      PR_BODY=$(su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && git log --format='%B' -1" 2>/dev/null) || true
    fi

    if [[ -n "$PR_BODY" ]]; then
      COMMENT_FILE="/run/docker-git/agent-comment.txt"
      printf "%s" "$PR_BODY" > "$COMMENT_FILE"
      chmod 644 "$COMMENT_FILE"
      su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && gh issue comment '$ISSUE_NUM' --body-file '$COMMENT_FILE'" || echo "[agent] failed to comment on issue #$ISSUE_NUM"
    else
      echo "[agent] no PR body or commit message found, skipping comment"
    fi

    echo "[agent] moving issue #$ISSUE_NUM to review..."
    MOVE_SCRIPT="/run/docker-git/project-move.sh"
    cat > "$MOVE_SCRIPT" << 'EOFMOVE'
#!/bin/bash
. /run/docker-git/agent-env.sh 2>/dev/null || true
cd "$1" || exit 1
ISSUE_NUM="$2"

ISSUE_NODE_ID=$(gh issue view "$ISSUE_NUM" --json id --jq '.id' 2>/dev/null) || true
if [[ -z "$ISSUE_NODE_ID" ]]; then
  echo "[agent] could not get issue node ID, skipping move"
  exit 0
fi

GQL_QUERY='query($nodeId: ID!) { node(id: $nodeId) { ... on Issue { projectItems(first: 1) { nodes { id project { id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } } } } }'

ALL_IDS=$(gh api graphql -F nodeId="$ISSUE_NODE_ID" -f query="$GQL_QUERY" \
  --jq '(.data.node.projectItems.nodes // [])[0] // empty | [.id, .project.id, .project.field.id, ([.project.field.options[] | select(.name | test("review"; "i"))][0].id)] | @tsv' 2>/dev/null) || true

if [[ -z "$ALL_IDS" ]]; then
  echo "[agent] issue #$ISSUE_NUM is not in a project board, skipping move"
  exit 0
fi

ITEM_ID=$(printf "%s" "$ALL_IDS" | cut -f1)
PROJECT_ID=$(printf "%s" "$ALL_IDS" | cut -f2)
STATUS_FIELD_ID=$(printf "%s" "$ALL_IDS" | cut -f3)
REVIEW_OPTION_ID=$(printf "%s" "$ALL_IDS" | cut -f4)
if [[ -z "$STATUS_FIELD_ID" || -z "$REVIEW_OPTION_ID" || "$STATUS_FIELD_ID" == "null" || "$REVIEW_OPTION_ID" == "null" ]]; then
  echo "[agent] review status not found in project board, skipping move"
  exit 0
fi

MUTATION='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }'

MOVE_RESULT=$(gh api graphql \
  -F projectId="$PROJECT_ID" \
  -F itemId="$ITEM_ID" \
  -F fieldId="$STATUS_FIELD_ID" \
  -F optionId="$REVIEW_OPTION_ID" \
  -f query="$MUTATION" 2>&1) || true

if [[ "$MOVE_RESULT" == *"projectV2Item"* ]]; then
  echo "[agent] issue #$ISSUE_NUM moved to review"
else
  echo "[agent] failed to move issue #$ISSUE_NUM in project board"
fi
EOFMOVE
    chmod +x "$MOVE_SCRIPT"
    su - ${config.sshUser} -c "$MOVE_SCRIPT '$TARGET_DIR' '$ISSUE_NUM'" || true
  fi

  if [[ "$AGENT_OK" -eq 1 ]]; then
    echo "[agent] done"
    touch "$AGENT_DONE_PATH"
  else
    echo "[agent] failed"
    touch "$AGENT_FAIL_PATH"
  fi
fi`

export const renderEntrypointBackgroundTasks = (config: TemplateConfig): string =>
  `# 4) Start background tasks so SSH can come up immediately
(
${renderEntrypointAutoUpdate()}

${renderEntrypointClone(config)}

${renderAgentLaunch(config)}
) &`
