# Logo refresh — lessons

- **Show options before applying a mark.** Round 1 was picked by me and
  applied everywhere, and the user rejected it on sight. Identity work is
  taste the user owns: render 2–3 directions side by side (sizes, themes,
  lockup) and let them choose before touching code.
- **"Legible at 16px" is necessary, not sufficient.** Round 1 passed every
  measurable check and still looked dated. Benchmark against current
  brand marks: one color, one idea, no outlines or inner tiles.
- **Screen candidates for unintended readings.** `#` is Slack/hashtag, a
  W with a crossbar is ₩, a w with a dot is a person. Look at each draft
  asking "what else is this?" before presenting it.
- **Small wordmarks take Fraunces' text cut.** Automatic optical sizing at
  17–19px picks the chunky low-opsz cut; pin `"opsz" 144` for a wordmark.
- **A theme-flipping variable is fine for a one-color mark, wrong for a
  multi-tone one.** The original outline vanished because two of its tones
  converged in dark mode; a single color only changes value.
- **A font that fails to load renders a fallback silently.** Instrument
  Serif in the font comparison came out as a sans; check every candidate
  actually rendered before judging it.
- **"The image at the bottom of the homepage" means the page's last image.**
  I read "첫화면 하단" as under the hero and asked about the live demo;
  the user meant the BigWaffle in the last panel. Screenshot the whole
  page and point at the candidate before asking about the wrong one.
- **A brand palette token can be a document color.** `palette.neutrals`
  fed the docs default text, formatting swatches and a slide theme, so
  restyling the brand by editing it would have recolored content. Grep a
  token's consumers before changing its value; split a brand-only set.
