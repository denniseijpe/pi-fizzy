# Changelog

## 0.2.3

- Stopped checking Fizzy assignment automatically after `edit` and `write` tool calls.
- `/fizzydo` and `/fizzyplan` now move the card into `Doing` up front instead of waiting for later edits.
- Automatic self-assignment is no longer attempted during work-start transitions; users can still assign explicitly with `fizzy_assign`.
- Migrated from `@sinclair/typebox` to `typebox` to match the current pi extension/runtime dependency expectations.

## 0.2.2

- Fixed self-assignment to use Fizzy's `POST /cards/:card_id/self_assignment` endpoint instead of `POST /cards/:card_id/assignments`, which only works when assigning another board user by id.

## 0.2.1

- When work starts on a Fizzy card, the extension now assigns the card to pi in addition to moving it into `Doing`.
- Added an internal non-toggling assignment helper so automatic work-start assignment does not accidentally unassign cards that are already assigned.

## 0.2.0

- Added `fizzy_assign` tool so pi can assign itself to a Fizzy card. Calls `POST /:account_slug/cards/:card_number/assignments` using the current user's identity from `GET /my/identity`. Toggles assignment, so calling it again will unassign.
