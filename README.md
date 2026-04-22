# pi-fizzy

A pi extension for loading a Fizzy card into the session, turning it into an immediate build prompt, or starting with a plan-first prompt.

Please note: This is fully vibe coded by pi itself.

## Install

### From npm

```bash
pi install npm:pi-fizzy
```

### From git

```bash
pi install git:github.com/denniseijpe/pi-fizzy
```

## Commands

- `/fizzy https://app.fizzy.do/projectid/cards/cardid`
  - Fetches the card, steps, and recent comments.
  - Stores it as the active Fizzy card on the session.
  - Injects the card details into the conversation context without starting work automatically.
  - Prompts the user with: `Fizzy card loaded. What do you want to do?`
- `/fizzydo https://app.fizzy.do/projectid/cards/cardid`
  - Fetches the card, steps, and recent comments.
  - Moves the card into `Doing` before immediate implementation starts, creating the column if needed.
  - Assigns the card to pi when work starts.
  - Immediately sends a build prompt to pi.
- `/fizzyplan https://app.fizzy.do/projectid/cards/cardid`
  - Fetches the same data.
  - Starts with planning instructions and explicitly tells pi not to edit files yet.
  - When pi later starts editing files for that card, the extension will move it into `Doing` if needed and assign it to pi.
- `/fizzycurrent`
  - Shows the current active Fizzy card stored on the session.

## Extra tools

- `fizzy_get_card`
  - Available to the agent during normal work.
  - Lets pi refresh the live card context later if needed.
  - If the session already has a current Fizzy card, the URL can be omitted.

- `fizzy_add_comment`
  - Posts a comment back to Fizzy.
  - Uses the current session's active Fizzy card when no URL is provided.

- `fizzy_move_to_column`
  - Moves a card to a named column such as `Doing`, `Review`, or `QA`.
  - Creates the target column if it does not exist yet.
  - Special case: `Maybe` / `Maybe?` uses Fizzy's built-in `Maybe?` stream instead of creating a normal column.
  - Uses the current session's active Fizzy card when no URL is provided.

- `fizzy_mark_done`
  - Marks a card done in Fizzy.
  - Uses the current session's active Fizzy card when no URL is provided.

- `fizzy_assign`
  - Assigns the current user (pi) to a Fizzy card.
  - Uses the current session's active Fizzy card when no URL is provided.
  - Toggles assignment: calling it again on an already-assigned card will unassign.

## Session behavior

When you run `/fizzy`, `/fizzydo`, or `/fizzyplan`, the extension stores the current Fizzy card on the pi session.

If pi is running with a TUI, the extension also shows a small non-blocking overlay in the top-right corner with the current card number and a truncated title.

When pi starts actively working on a card, the extension also tries to move the card into a `Doing` column and assign it to pi. If that column does not exist yet, it creates it first.

That means later prompts like:

- `write a small comment with a summary and then mark the issue as done`

can resolve `the issue` against the active Fizzy card for the current session.

## Auth setup

This extension reads credentials from `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`).

Merge this entry into the top-level object in that file:

```json
{
  "fizzy": {
    "type": "api_key",
    "key": "YOUR_FIZZY_PERSONAL_ACCESS_TOKEN",
    "baseUrl": "https://app.fizzy.do"
  }
}
```

Notes:
- `baseUrl` is optional if you always use `https://app.fizzy.do/...` URLs, but it is useful for self-hosted Fizzy instances.
- `key` can be:
  - a literal token,
  - an environment variable name,
  - or a shell command prefixed with `!`.

Examples:

```json
{
  "fizzy": {
    "type": "api_key",
    "key": "FIZZY_API_TOKEN"
  }
}
```

```json
{
  "fizzy": {
    "type": "api_key",
    "key": "!op read 'op://Private/Fizzy/token'"
  }
}
```

## Creating a Fizzy token

Fizzy supports personal access tokens.

In Fizzy:
1. Open your profile.
2. Go to the API section.
3. Open **Personal access tokens**.
4. Generate a new token.
5. Give it permissions that cover the actions you want pi to perform.
6. For `/fizzy`, `/fizzydo`, `/fizzyplan`, and `fizzy_get_card`, read access is enough.
7. For `fizzy_add_comment`, `fizzy_move_to_column`, `fizzy_mark_done`, and `fizzy_assign`, the token also needs write access.
