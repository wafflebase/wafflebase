# Remove the eval subsystem — lessons

- A credential-backed workflow that fails red for six weeks unnoticed is the
  failure mode, not the expired token. Red notifications that go to merged-PR
  authors, not to whoever owns the credential, are ignored.
- Before deleting a subsystem, map couplings in the surviving files, not in
  the deleted ones: the breakage was a verify lane, a test import and a test
  that read a workflow file from disk, none of them in `eval/`.
- Guards that protect live code can live inside the subsystem being removed
  (`eval/test-lane.test.mjs`). Relocate them; deleting the directory would
  have silently dropped them.
- `verify:entropy` treats backticked file names in design docs as references;
  write removed files as prose in history notes.
