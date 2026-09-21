# Face recognition

## The requirement that shaped this

This product is for South Indian bus depots. A large proportion of the drivers
it will be pointed at have dark skin. Face pipelines assembled from defaults
fail that group more often than they fail lighter-skinned users, and they fail
it in a particular way: the _recognition_ model is usually not the problem, the
**capture and quality gate in front of it** is. A frame is rejected as "too
dark" before the recogniser ever sees it, or the recogniser receives a
low-contrast crop and returns a weak descriptor.

So the work here is concentrated where the failure actually happens — in
capture, normalisation and the quality gate — and the claims below are tested
rather than asserted.

## The pipeline

```
camera frame
   │
   ├─ detect (Human, guidance pass, no descriptor)   ← fast, drives the on-screen ring
   │
   ├─ measureFrameQuality()      src/lib/face-image.ts
   │     sharpness · face-box contrast · face-box brightness · size ·
   │     detection score · backlight ratio · yaw/pitch
   │
   ├─ gate (assessFrameQuality)  @domain/face-match.ts
   │     blocking issues → retry with specific guidance
   │     warnings        → proceed, and say what might help
   │
   ├─ prepareFaceCropForRecognition()   src/lib/face-image.ts
   │     crop with 35% margin → 256px → CLAHE → gamma normalisation
   │
   ├─ describe (Human, on the normalised crop)  →  128-d descriptor
   │
   └─ matchFace()                @domain/face-match.ts
         cosine similarity vs depot-scoped candidates
         → AUTO_ACCEPT · REVIEW · NOT_VERIFIED
```

The two-pass structure matters: the guidance pass runs with `embed: false` so
the live preview stays responsive, and the descriptor is computed once, on the
normalised crop, at the moment of capture.

## What the quality gate measures — and what it refuses to

`FrameQualitySignals` is measured **inside the detected face box**, not over the
whole frame. A frame-wide brightness average says more about the wall behind the
driver than about the driver.

| Signal                                      | Blocking?      | Why                                        |
| ------------------------------------------- | -------------- | ------------------------------------------ |
| `faceCount` = 0                             | **blocks**     | Nothing to match                           |
| `faceCount` > 1                             | **blocks**     | Ambiguous; which person is being recorded? |
| `faceAreaRatio` too small                   | **blocks**     | Too few pixels to describe                 |
| `sharpness` (Laplacian variance) too low    | **blocks**     | Motion blur destroys descriptors           |
| `faceContrast` < `MIN_FACE_CONTRAST` (0.16) | **blocks**     | Genuinely no detail to work with           |
| `faceBrightness` low                        | _warning only_ | **See below**                              |
| `backlitRatio` > 2.0                        | _warning only_ | Suggests moving, does not refuse           |
| `yaw` / `pitch` extreme                     | _warning only_ |                                            |
| low detection confidence                    | _warning only_ |                                            |

**Mean brightness contributes nothing to the composite quality score, and never
blocks a capture.** This is the central fairness decision in the file. A dark
face correctly exposed is a perfectly good input; a naive "too dark, try again"
gate rejects exactly the users this product exists to serve, over and over,
until the manager gives up and uses manual entry for that driver — which is how
a technical default becomes a policy of excluding people.

What _does_ block is **contrast** — a measure of whether there is detail
present, independent of how bright that detail is — and sharpness, which is the
real enemy in a moving depot yard.

The composite score weights:

|                      | weight |
| -------------------- | ------ |
| sharpness            | 0.32   |
| face-box contrast    | 0.28   |
| face size            | 0.24   |
| detection confidence | 0.16   |

multiplied by a clipping penalty (blown highlights or crushed shadows are a real
loss of information, in either direction).

## Normalisation: CLAHE plus gamma

`applyClahe()` is contrast-limited adaptive histogram equalisation implemented
directly in `src/lib/face-image.ts`:

- **64 bins** (`BIN_SHIFT = 2`), not 256. This is not a performance choice — it
  is the difference between working and not. On a 64-pixel tile, a 256-bin
  histogram has an average bin height below 1, the clip limit floors to 1, and
  the mapping flattens instead of stretching. That bug reduced contrast on dark
  faces, which is the exact opposite of the intent.
- **Adaptive tile count**, `max(2, min(8, floor(min(w,h) / 32)))`, so small
  crops are not diced into tiles with no statistics in them.
- **Clip limit as a multiple of the average bin height**, so it scales with tile
  size rather than being a magic constant.
- **Bilinear interpolation** between tile maps, so no visible tile seams.
- **Hue-preserving**: the luma channel is remapped and the RGB channels scaled
  by the same factor, so the driver's skin tone is not shifted. Equalising each
  channel independently would change the colour of the face, which is both wrong
  and, in this context, ugly.

`normaliseExposure()` then applies a gamma correction targeting mid-grey, with
gamma clamped to `[0.45, 2.2]` so a pathological frame cannot be pushed into
posterisation.

**Both are applied identically at enrolment and at scan.** This is essential:
comparing a normalised probe against an un-normalised gallery introduces a
systematic bias that looks exactly like a recognition failure.

## Performance across skin tones

This is the section the code refers to, and it is deliberately specific about
what has and has not been established.

### What is measured, and how

`tests/unit/face-image.test.ts` constructs synthetic face-like images at
controlled luminance levels and asserts properties of the normalisation
pipeline. The load-bearing result:

> A synthetic dark face with a within-face-box standard deviation of **3.87**
> (far below the `MIN_FACE_CONTRAST` gate, i.e. it would have been rejected)
> is raised to **16.66** by CLAHE plus gamma normalisation — comfortably above
> the gate. Applying the same pipeline to a light-toned equivalent brings the
> two means to within **2.3 luma units** of each other.

The second half is the point. It is not enough to brighten dark inputs; the
pipeline must bring dark and light inputs into _the same range_, because a
recogniser compares descriptors across the whole gallery.

`tests/unit/face-match.test.ts` covers the decision layer: that the quality
gate's blocking set contains no brightness-derived issue, that a dark frame with
adequate contrast passes while a low-contrast frame of any brightness does not,
and that the composite score for a dark, sharp, well-framed face equals that of
a light one with the same sharpness and framing.

### What has _not_ been established

**No accuracy figures are claimed, for any group.** These tests establish that
the capture and normalisation stages do not disadvantage dark-skinned subjects.
They say nothing about the false-match or false-non-match rate of the underlying
model, because measuring that honestly requires a real, demographically
annotated evaluation set which this project does not have and should not invent.

Anyone deploying this at scale should measure it on their own population. The
hooks are there: every attendance record stores `face_match_score`, the
threshold that was applied and the decision, so a depot's actual distribution of
similarities can be analysed after a few weeks of use, and `app_settings`
exposes the thresholds per organisation so they can be tuned on evidence rather
than on the defaults below.

### Mitigations that do not depend on the model being good

The design assumes recognition will sometimes fail, for anyone:

- **Manual entry is always one tap away**, never buried, and it records a reason
  code — it is a first-class path, not a punishment.
- **`REVIEW` is a real outcome**, not a rounding of `AUTO_ACCEPT`. Between
  `faceReviewSimilarity` (0.50) and `faceAutoAcceptSimilarity` (0.62), the
  manager is shown the candidate and confirms. Nothing is recorded silently.
- **`MIN_DECISION_MARGIN` (0.06)** — if the best and second-best candidates are
  closer than this, the result is downgraded to `REVIEW` regardless of the top
  score. Two similar-looking drivers in one depot must not resolve by a hair.
- **Model-version mismatch downgrades**: a descriptor computed by a different
  model version (`MODEL_VERSION = 'human-faceres-3.3+clahe1'`, which includes
  the normalisation stage) is never auto-accepted against a current one.
- **The server re-checks.** `rpc_record_attendance` independently verifies the
  similarity against the stored threshold and the liveness requirement. A client
  that posts a flattering score does not get a pass.

## Thresholds

| Setting                    | Default | Meaning                                             |
| -------------------------- | ------- | --------------------------------------------------- |
| `faceAutoAcceptSimilarity` | 0.62    | At or above, one tap confirms                       |
| `faceReviewSimilarity`     | 0.50    | Below this, "not verified" — never a silent match   |
| `faceMinQuality`           | 0.45    | Composite gate for enrolment photos and scan frames |
| `faceRequireLiveness`      | true    | Anti-spoof and liveness both on                     |
| `faceMinEnrolmentPhotos`   | 3       | Minimum usable photos to complete enrolment         |
| `MIN_DECISION_MARGIN`      | 0.06    | Required gap between best and second-best           |

All are per-organisation columns in `app_settings`, editable by an administrator
and snapshotted onto every anomaly and attendance record.

## Enrolment

Three or more photographs at different poses, each passing the quality gate,
each with a recorded `quality_score` and `pose_hint`. Descriptors are averaged
(`averageDescriptors`) after normalisation. `canCompleteEnrolment` enforces the
minimum count of _usable_ photos — not photos taken.

Consent is a gate, not a checkbox: `biometric_consents` must hold an
unrevoked row before the camera opens, and the E2E specs assert that no `<video>`
element exists until it does.

## Privacy and data handling

- Descriptors live in `face_embeddings` as `double precision[]` with a dimension
  check. **They are never returned by any ordinary employee API response.** The
  only read path is `rpc_face_candidates`, which is depot-scoped and returns
  assigned drivers first.
- `src/lib/logger.ts` strips `embedding`, `descriptor`, `imageData`, `blob`,
  `dataUrl`, `base64` and similar keys at any depth, and replaces any numeric
  array longer than 32 with `[vector]`. A descriptor cannot reach a log line.
- Photographs live in a **private** bucket under
  `organizations/{orgId}/employees/{employeeId}/faces/…`, reachable only by
  short-lived signed URLs. EXIF is stripped before upload.
- **No age, gender or emotion estimation.** These are explicitly disabled in
  `src/providers/face/humanProvider.ts`, not merely unused.
- `rpc_delete_biometric_data` removes an individual's embeddings and photographs
  on request, writing an audit record of the deletion. `fn_purge_expired_media`
  enforces the retention window, and refuses to purge evidence attached to an
  open anomaly.
- Enrolment, re-enrolment and deletion are all audited.
