# E2E fixture audio

This directory should contain `short.webm` — a ~2 second WebM/Opus audio file.

Generate it with ffmpeg:

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" \
  -ar 48000 -ac 1 -c:a libopus \
  e2e/fixtures/short.webm
```

The placeholder file committed here is not a valid WebM and will cause the
E2E test to fail at the transcription step. Replace it before running `npm run e2e`.
