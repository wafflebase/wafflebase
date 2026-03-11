# Lessons

- Bundle verification should cap both maximum chunk size and total chunk count
  so splitting one risk does not silently introduce another.
- Set chunk-count defaults with some headroom over current output to reduce
  noise while still catching sudden chunk fan-out regressions.
