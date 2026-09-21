# The anomaly engine

## What it is for

A bus went out with 402 km of range and came back having covered 61 km with 180
km of range gone. That might be a jammed sensor, a badly photographed gauge, a
diversion nobody logged, a long idle in traffic, or something worth a
conversation. **The engine's job is to notice; a person's job is to decide.**

Every output of this module is a _finding_ — a set of numbers, the threshold
that was in force, and interpolation parameters the UI turns into a sentence in
the manager's language. There is no verdict, no accusation and no language in
the product suggesting one.

## Where it runs

`supabase/functions/_shared/domain/anomaly-engine.ts` — pure TypeScript, no I/O,
no clock reads. The browser imports it as `@domain/anomaly-engine.ts` to
_explain_ a finding; `trip-finalise` imports it by relative path to _decide_
one. One implementation, so the explanation and the decision cannot drift apart.

The decision is made server-side because the person being reviewed is often the
person holding the phone. `trip-finalise` takes only a trip id and reads the
readings, thresholds and baseline from the database itself.

## Metrics, computed first

`@domain/trip-metrics.ts` derives everything the rules need:

| Metric                          | From                                                   |
| ------------------------------- | ------------------------------------------------------ |
| `distanceKm`                    | end odometer − start odometer                          |
| `distanceVariancePct`           | against the trip's **snapshotted** expected distance   |
| `rangeDropKm`, `rangeDropPerKm` | start range − end range, per km driven                 |
| `fuelUsedLitres`                | fuel percentage delta × tank capacity, plus any refuel |
| `efficiencyKmpl`                | distance ÷ litres                                      |
| `durationMinutes`               | actual end − actual start                              |

Two rules govern this module, and they are the reason it is separate:

- **`null` means unknown. It is never `0`.** A missing fuel reading is not
  "zero litres used"; a bus with no recorded tank capacity has no computable
  efficiency. Conflating the two manufactures anomalies out of missing data,
  which is the fastest way to teach a manager to ignore alerts.
- **No litres for an electric bus, ever**, and none for a bus with an unknown
  tank. `fuelUsedLitres` and `efficiencyKmpl` are `null`, and the fuel rules do
  not fire.

The _snapshot_ matters too: trips store `expected_distance_km` and
`distance_tolerance_pct` as they were when the trip started. Editing a route
afterwards must not retroactively make last month's trips anomalous.

## Baselines

A rule that compares against a fleet-wide constant is wrong on the first hill.
`bus_baselines` holds per-bus, optionally per-route statistics computed by
`rpc_recompute_bus_baseline`:

- **median**, not mean — one catastrophic reading should not move the reference;
- **MAD** (median absolute deviation) alongside it, so "unusual" is measured in
  units of this bus's own spread;
- `percentile_cont` in SQL, over a rolling `baselineWindowDays` (default 90);
- trips already resolved as `READING_ERROR` are **excluded**, so a known-bad
  reading does not poison the reference;
- a route-specific baseline is preferred over the bus's overall one, because a
  city route and a highway route have genuinely different fuel figures.

Until `minTripsForBaseline` (default 8) completed trips exist, the configured or
manufacturer figure is used instead — and any finding based on it says so
(`baselineConfigured`), so a reviewer knows they are looking at an assumption
rather than this bus's history.

`robustZScore(value, median, mad)` is the comparison used throughout.

## The eleven rules

| #   | Kind                         | Code                                | Fires when                                                      | Default severity          |
| --- | ---------------------------- | ----------------------------------- | --------------------------------------------------------------- | ------------------------- |
| 1   | `DISTANCE_VARIANCE`          | `distance.variance.v1`              | Driven distance is outside the route's tolerance band           | MEDIUM → HIGH with excess |
| 2   | `ODOMETER_REGRESSION`        | `odometer.regression.v1`            | End odometer is below start                                     | HIGH                      |
| 3   | `ODOMETER_IMPLAUSIBLE`       | `odometer.implausible.v1`           | Distance exceeds what a bus can cover (`MAX_PLAUSIBLE_TRIP_KM`) | HIGH                      |
| 4   | `RANGE_DROP`                 | `range.drop.v1`                     | Range fell far faster per km than this bus's baseline           | MEDIUM                    |
| 5   | `LOW_EFFICIENCY`             | `efficiency.low.v1`                 | km/L well below this bus's median on this route                 | MEDIUM                    |
| 6   | `FUEL_DROP_WITHOUT_DISTANCE` | `fuel.drop_without_distance.v1`     | Fuel fell materially with little or no distance                 | HIGH                      |
| 7   | `READING_CONFIDENCE`         | `reading.low_confidence.v1`         | OCR confidence below the medium band and unverified             | LOW                       |
| 8   | `READING_CORRECTION`         | `reading.substantial_correction.v1` | A manager changed an OCR value substantially                    | LOW                       |
| 9   | `DUPLICATE_CAPTURE`          | `capture.duplicate.v1`              | The same image hash was already submitted for this bus          | MEDIUM                    |
| 10  | `DURATION_INCONSISTENT`      | `trip.duration_inconsistent.v1`     | Elapsed time is implausible for the distance                    | LOW–MEDIUM                |
| 11  | `MISSING_END_READING`        | `trip.missing_end_reading.v1`       | Completed with an override instead of a reading                 | MEDIUM                    |

Rules 7, 8 and 9 exist because **the system must be suspicious of itself before
it is suspicious of anyone**. A low-confidence reading, a large manual
correction and a duplicated photograph are all facts about the _evidence_, and a
reviewer should see them next to whatever the evidence implies.

Rule 9 in particular has an innocent explanation (a double tap, a retry on a
flaky connection) that is indistinguishable from the one needing a look — which
is exactly why it produces a review item and not a conclusion.

## Scoring

Each rule returns a raw 0–100 score, compressed with `gradeExcess`, which is
logarithmic (`log2`-based): the difference between 10% and 20% over tolerance
matters much more than between 200% and 210%. Linear scoring puts one absurd
reading permanently at the top of the queue and buries everything real beneath it.

The score is then multiplied by the rule's configured `weight`, letting an
operator de-prioritise a rule that is noisy in their fleet without switching it
off entirely.

`anomalyScore` for a trip is the **highest** single finding, not a sum. Ten
low-grade observations are not one serious problem, and summing them would say
they were.

**Findings are ordered severity first, then score** — and `requiresReview` is
true only if at least one finding is above `LOW`. Low-severity findings appear
on the trip for context but do not drag it into the review queue. If everything
lands in the queue, nothing does.

## Thresholds

Per organisation, in `app_settings`, editable by an administrator on the
Thresholds screen:

| Setting                      | Default | Meaning                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------ |
| `distanceTolerancePct`       | 10      | Normal band around a route's expected distance                           |
| `efficiencyDropTolerancePct` | 20      | How far below baseline efficiency is worth attention                     |
| `rangeDropTolerancePct`      | 35      | How far above the expected range drop is worth attention                 |
| `minTripsForBaseline`        | 8       | Completed trips before a learned baseline outranks the configured figure |
| `baselineWindowDays`         | 90      | Rolling window for baseline statistics                                   |
| `ocrHighConfidence`          | 0.85    | Boundary of the HIGH confidence band                                     |
| `ocrMediumConfidence`        | 0.60    | Below this, a reading is flagged as uncertain                            |
| `rules`                      | `{}`    | Per-rule `{ enabled, weight }` overrides                                 |

Defaults are conservative on purpose: raising a reviewable anomaly is cheaper
than quietly accepting a reading nobody looked at.

Each route may also carry its own `distance_tolerance_pct`, which overrides the
organisation default and is snapshotted onto the trip.

## Explicability over time

Every `anomalies` row stores `rule_code`, `rule_version` and
`threshold_snapshot`. An administrator who tightens the distance tolerance in
March does not retroactively change what February's anomalies meant — each one
still carries the numbers it was judged against. Without this, an audit trail of
reviews becomes unreadable the first time a setting changes.

`detail` holds interpolation **parameters**, never a rendered sentence, so the
same finding reads correctly in English, Tamil, Telugu and Kannada — including
one written before the reviewer switched language.

## Review

A finding is `OPEN` until a person resolves it as one of:

| Outcome               | Means                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| `REVIEWED_OK`         | Looked at; there is an ordinary explanation                             |
| `NEEDS_INVESTIGATION` | Escalated to someone else                                               |
| `FALSE_POSITIVE`      | The rule was wrong here                                                 |
| `READING_ERROR`       | The evidence was wrong — and the trip is excluded from future baselines |

Every resolution requires a written note of at least ten characters, and
`anomaly_reviews` is append-only: a decision can be superseded, never erased.

`READING_ERROR` closes the loop on data quality — a misread gauge, once marked,
stops distorting the reference this bus is judged against.

## Testing

- `tests/unit/anomaly-engine.test.ts` — each rule at, just below and just above
  its threshold; weighting; disabled rules; ordering.
- `tests/unit/trip-metrics.test.ts` — the `null`-not-zero rule, electric buses,
  unknown tank capacity, median and MAD.
- `tests/integration/anomaly-pipeline.test.ts` — OCR text → readings → findings,
  asserting that a value which arrived via the parser produces the identical
  verdict to the same value typed by hand.
- `supabase/tests/10_rls_test.sql` — that distance and variance are computed
  server-side and that the derived figures match.
