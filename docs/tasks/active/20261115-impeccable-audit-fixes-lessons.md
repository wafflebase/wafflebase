# Impeccable audit fixes — lessons

- The dev server on :5173 belonged to another checkout (`waffledocs`). Check
  the process cwd (`lsof -p <pid> | grep cwd`) before trusting a rendered
  audit of localhost.
