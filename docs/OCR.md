# Dashboard OCR

## The problem

A manager photographs a bus dashboard in a depot yard. The picture has: a
seven-segment odometer at an angle, a range readout in a different font, a fuel
bar, glare from the windscreen, and whatever the sun is doing. From that we need
three numbers, and we need to know how much to trust each of them.

Generic OCR on that image returns a soup of tokens. The work is in the parsing,
not the recognition.

## Pipeline

```
photograph
  │
  ├─ src/lib/image.ts        strip EXIF · downscale · compress · perceptual hash
  │
  ├─ Tesseract.js (lazy)     words with bounding boxes and per-word confidence
  │
  ├─ @domain/ocr-parse.ts    normalise glyphs · score candidates · assign fields
  │
  ├─ OCRReview.tsx           every value shown for confirmation, before saving
  │
  └─ dashboard_readings      ocr_value · ocr_confidence · final_value · was_corrected
```

Tesseract is dynamically imported the moment a capture screen opens, never at
boot. Recognition happens on the device: no photograph is transmitted for
analysis, and there is no per-call cost.

## Glyph repair

`normaliseNumericToken` fixes the confusions that seven-segment displays and
low-light photographs actually produce:

| Seen               | Meant |
| ------------------ | ----- |
| `O`, `o`, `Q`, `D` | `0`   |
| `I`, `l`, `        | `     | `1` |
| `S`                | `5`   |
| `B`                | `8`   |
| `Z`                | `2`   |
| `G`                | `6`   |

It is applied **only inside tokens that are already mostly digits**, so the word
"RANGE" is never mangled into "R4NG3". Separators and stray punctuation are
stripped; a decimal point is preserved.

## Field assignment

`parseDashboardWords` scores every numeric candidate for every field and takes
the best, using:

- **Label proximity.** A number next to "ODO", "KM", "TRIP", "RANGE", "FUEL" or
  "%" is far more likely to be that field. Distance is measured between bounding
  boxes, not in the text stream, because OCR reading order on a dashboard is
  arbitrary.
- **Bounding-box area.** The odometer is usually the largest number on the
  panel.
- **Plausibility against the previous odometer.** This is the strongest signal
  available and the one a generic OCR service cannot use. It disambiguates
  `86542` from `8654`, and it is why an _impossible_ reading is capped rather
  than merely penalised: a value below the bus's last odometer, or implausibly
  far above it, has its score hard-capped at 0.2, so **no amount of label or
  size bonus can rescue it**. An earlier version subtracted a fixed penalty, and
  a large, well-labelled impossible number still won.
- **Range constraints.** A fuel percentage outside 0–100 is not a fuel
  percentage.

The parser returns readings _and_ an explicit `missing` list of fields it could
not find. Absence is reported, never filled in — the UI asks the manager for
those by hand.

## Confidence bands

Per-word confidence is mapped through `confidenceBand` against the
organisation's thresholds:

| Band   | Default | Shown as                                                            |
| ------ | ------- | ------------------------------------------------------------------- |
| HIGH   | ≥ 0.85  | Confirm and move on                                                 |
| MEDIUM | ≥ 0.60  | Confirm, with the value pre-selected for easy editing               |
| LOW    | < 0.60  | Highlighted; the manager is asked to check it against the dashboard |

A LOW band also raises a `READING_CONFIDENCE` finding on the trip, so a reviewer
looking at any other anomaly can see that the evidence behind it was shaky. The
system is suspicious of itself before it is suspicious of anyone.

## Nothing is saved unread

`OCRReview` shows every parsed value next to the source text it came from, and
saves only what the manager confirms. When they change a value:

- `final_value` is what they entered, `ocr_value` keeps what the machine read;
- `was_corrected`, `corrected_by` and `corrected_at` are set — a table CHECK
  enforces that those three are consistent;
- `source` becomes `OCR_CORRECTED` rather than `OCR`.

A _substantial_ correction raises a `READING_CORRECTION` finding. This is not
suspicion of the manager: it is a data-quality signal. A bus whose readings are
routinely corrected by 40% has a dashboard that photographs badly, and that is
worth knowing.

Full manual entry is always available in one tap, and it is a first-class path —
`source` is `MANUAL` and the trip proceeds normally. There is no penalty for a
camera that will not focus.

## Duplicate detection

`src/lib/image.ts` computes a perceptual hash (FNV-1a over a 16×16 luma grid),
stored on the capture. If the same hash appears for the same bus on a different
trip, `trip-finalise` raises `DUPLICATE_CAPTURE`.

Perceptual rather than cryptographic, because re-encoding changes bytes but not
the picture. And, as noted in the anomaly documentation, a duplicate has an
entirely innocent explanation that is indistinguishable from the one worth
asking about — which is precisely why it produces a review item, not a
conclusion.

## Raw responses

`dashboard_captures.ocr_raw_response` keeps the full engine output for debugging
a bad parse. It is stripped by `fn_redact` before anything reaches an audit row,
and by `src/lib/logger.ts` before anything reaches a log line.

## Replacing the engine

`src/providers/ocr/` defines the interface; `tesseractProvider` and
`mockProvider` implement it. A cloud OCR service would be a third file plus a
configuration value — but note that it would send dashboard photographs to a
third party, which is a decision worth making deliberately rather than by
default.

**Parsing is not part of the adapter.** `@domain/ocr-parse.ts` consumes words
with boxes and confidences, so swapping the recogniser does not change field
assignment, the confidence bands, or any of the tests covering them.

## Testing

`tests/unit/ocr-parse.test.ts` covers glyph repair, label proximity, the
previous-odometer cap, fuel range constraints, and the `missing` list.
`tests/integration/anomaly-pipeline.test.ts` asserts that a value arriving
through the parser produces the same verdict as the same value typed by hand.
