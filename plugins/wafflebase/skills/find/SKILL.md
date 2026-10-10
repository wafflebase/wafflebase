---
name: find
description: Find Wafflebase documents by title or topic and list them with links
argument-hint: <query>
disable-model-invocation: true
---

Find Wafflebase documents matching: $ARGUMENTS

Follow the core `wafflebase` skill.

1. Run `wafflebase docs list` (and `wafflebase folders list` if the query
   names a folder).
2. Match the query against titles case-insensitively, including partial
   words and Korean/English variants of the same word. If the query names
   a type ("sheet", "deck", "회의록 문서"), filter on `type`.
3. Reply with a table — Title, Type, Last updated, Link — newest first,
   at most 15 rows. Say how many more matched if you cut it.
4. Nothing matched → say so and show the five most recently updated
   documents instead.

Do not open document content unless the user asks a question about it.
