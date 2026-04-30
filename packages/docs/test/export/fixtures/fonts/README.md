# Test Fonts

`test-cjk.ttf` — small CJK-capable test font used by Vitest tests for
`pdf-fonts.ts` and `pdf-painter.ts`. Not bundled into the production
package; tests inject it as font bytes via dependency injection.

**Source:** Noto Sans KR Regular (Google Fonts), subset by the Google
Fonts CSS API to a small character set:
`가나다라마바사아자차카타파하 안녕하세요 Hello World 0123456789.,!?-:`

**License:** SIL Open Font License (OFL).
**Size:** ~68 KB (516 glyphs after subsetting).

To regenerate (e.g., to refresh the font version), run:

```bash
URL=$(curl -sL -G -A "Mozilla/5.0" \
  --data-urlencode "family=Noto Sans KR:wght@400" \
  --data-urlencode "text=가나다라마바사아자차카타파하 안녕하세요 Hello World 0123456789.,!?-:" \
  "https://fonts.googleapis.com/css2" | grep -oE "https://[^)]+")
curl -sL -A "Mozilla/5.0" "$URL" -o test-cjk.ttf
```
