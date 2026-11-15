# Lessons — install-deps linked-path entry check

## What the bug taught

An entry check that compares a *typed* path with a *resolved* one fails open
in the quietest way available: the module simply does not run its top-level
block, so the process exits 0. Nothing refuses, nothing installs, and the
caller reads success. Both sides of such a comparison have to go through the
same resolution.

## Review rounds

(filled in during self-review)
