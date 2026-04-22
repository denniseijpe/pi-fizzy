# Changelog

## 0.2.0

- Added `fizzy_assign` tool so pi can assign itself to a Fizzy card. Calls `POST /:account_slug/cards/:card_number/assignments` using the current user's identity from `GET /my/identity`. Toggles assignment, so calling it again will unassign.
