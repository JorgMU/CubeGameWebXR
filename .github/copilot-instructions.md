# Agent Instructions

## Behavior Rules

- Items labeled ACTION may be performed by the agent.
- Items labeled REMINDER must only be mentioned in chat — never executed.
- Reminder message format: "Reminder: <task>. (I did not perform this task.)"
- If a task is unclear, ask before acting.
- Automatically stage newly created files unless the user explicitly says not to.

## Repo-Specific Workflow Rules

- Keep browser-served assets under `app/`; the local server intentionally exposes only that folder.
- Preserve the no-build workflow and the Three.js r160 CDN import map unless the user requests a change.
- Keep runtime asset URLs relative to `app/index.html` so they resolve from the web root.

## Session Startup Protocol

On the **first user message of every new conversation**, before addressing the request, run the full startup protocol below and confirm completion. Check `.github/context.json` for a `currentSession.startupComplete` flag — if it is `true` and the `startedAt` timestamp is from the current conversation, skip to the user's request instead.

At the start of each session:

1. ACTION: Confirm that a workspace folder is open in VS Code. If no workspace folder is open, stop immediately and send this reminder:
   > "Reminder: You have opened a file directly. Please close it and reopen the folder using File > Open Folder. I am not proceeding until you confirm."
   Do not continue past this point until the user confirms a folder is open.
2. REMINDER: In your visible/user terminal only (not any agent internal terminal), set location to the currently open workspace root folder. Provide a paste-ready command using that detected root path:
   `Set-Location "<detected-open-workspace-root-absolute-path>"`
3. ACTION: Read `.github/context.json` to review the last known state.
4. ACTION: Run a Context Conflict Check against active instructions, active skills, and existing project files.
   - If conflicts exist, list them and wait for approval before proceeding.
   - If no conflicts exist, say "No conflicts found" and proceed.
5. ACTION: Write `currentSession.startupComplete: true` and `currentSession.startedAt: <current datetime>` to `.github/context.json` to mark startup as done for this conversation.

## Session End Protocol

### Agent Actions

1. ACTION: Create new `Chat_<date>.md` and `Chat_<date>.txt` files in the `Conversations/` folder.
2. ACTION: If a previous session already has the same base date, append A-Z (for example, `Chat_2026-04-26A.md`) until the filename is unique.
3. ACTION: Ensure the `Chat_<date>.md` file includes a complete session summary: what was requested, what was changed, validations performed, and key decisions.
4. ACTION: Leave `Chat_<date>.txt` empty for the full raw conversation transcript to be pasted by the user.
5. ACTION: Once the transcript file is created, explicitly tell the user the file is ready for the transcript handoff and that the agent will wait for confirmation before any scan that depends on the pasted transcript.
6. ACTION: Update `.github/context.json` with `currentPosition`, `lastActions`, `lastUpdated`, and any useful context not already stored elsewhere.
7. ACTION: Determine whether a sensitive-information scan is required.
   - First read `.github/context.json` and use `repository.visibilityIntent` when present.
   - If intent is `public`, scan is required.
   - If intent is `private` or `internal`, skip scan unless the user explicitly requests it.
   - If intent is missing or `unknown`, determine upstream visibility before deciding.
     - Preferred: `gh repo view --json visibility -q .visibility`
     - Fallback: infer from authenticated GitHub API if possible.
     - If visibility still cannot be determined, treat as public for safety.
8. ACTION: After the user pastes the latest conversation into the appropriate `Chat_<date>.txt` file and confirms it is saved, run a sensitive-information check only when scanning is required by Step 7.
   - Scope: only version-controlled files in the repo.
   - If sensitive information is found, alert the user and halt publishing until resolved.
9. ACTION: Stage any modified files.

### Reminders (do not execute)

1. REMINDER: Paste the plain-text transcript into the appropriate `Chat_<date>.txt` file for this session.
2. REMINDER: Copy and paste the final transcript into your archive location.
3. REMINDER: Run `git commit` and `git push` to publish changes.

## Session Config

| Setting | Value |
|---|---|
| Response style | Short and direct |
| Commit policy | Explicit request only |
| Auto-stage new files | Yes |

## Key Files

| Purpose | Path |
|---|---|
| Session state | `.github/context.json` |
| Transcript (plain text) | `Conversations/Chat_<date>.txt` |
| Transcript summary | `Conversations/Chat_<date>.md` |
