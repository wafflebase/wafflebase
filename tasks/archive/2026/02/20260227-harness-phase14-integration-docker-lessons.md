# Lessons

- Integration lanes should not rely on implicit CI-only env vars; scripts need
  to force required flags so local and CI behavior stays aligned.
- For docker-backed local wrappers, track whether services were already
  running and only stop services that the wrapper started.
