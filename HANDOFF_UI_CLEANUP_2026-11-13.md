# Hand-off: UI clean-up (November 13, 2026)

Branch **`ui-cleanup-2026-11-13`**: the commits on top of `sandbox-fixes-2026-11-12` (PR #3). This branch is frontend-only, apart from two backend tests that read frontend source files. Before/after screenshots of 12 screens are in `UI_SCREENSHOTS/` at the top of the zip.

## What changed

| Area | Before | After |
|---|---|---|
| **Text sizes** | 29 sizes across the app (up to 15 on one screen); 256 places under 12 px, including the tab labels and the crisis-lines screen | One scale: 12 · 14 · 16 · 18 · 22 · 28 for text, 36 · 48 · 60 · 80 for display numbers. Nothing under 12 px. 820 sizes mapped and 247 line heights scaled. `TYPE.xs` is now 12. `src/__tests__/typeScale.test.js` fails on any size off the scale. |
| **Home** | Just arrested → emergency → $20 Quick Connect → plan upsell → tip → about 22 tiles | Just arrested → court-date countdown (when there is one) → emergency → **Quick access**: 8 tiles plus "Show all tools (N)" → **More options**: Quick Connect, plans → tip. The three tiles that only repeated the tab bar are gone. The person's own role/feature tiles come first. Nothing was removed; every test ID is unchanged. |
| **Tab bar** | Labels at 10 px | 12 px labels that wrap to two lines (bar 62 → 68 px). Checked in en / es / tl / vi / ar. |
| **Repeated titles** | Top bar and big heading said the same thing (Rights card, Quick Connect, Choose Your Plan, Just Arrested) | Each title appears once. The empty status-bar padding under the Quick Connect and Plans top bars is gone. |
| **Copy** | 911 strings with "--" (188 English, copied into ar / ht / tl / zh); "--" for empty values; a dark-mode switch labelled "Light Mode" when off | Real dashes everywhere. "Not set" / "—" for empty values. The switch always reads "Dark Mode". |
| **First run** | "24/7 · AI Legal Help" (shown even with AI off); slides claimed "rates", "matched to your case", "Bar-verified" | "8 · Languages"; slide text says only what the app does. All 8 languages. |
| **Just Arrested steps** | A finished step looked like one not started | Finished steps are green. |
| **Get Help** | 3 rows of filter chips above the results | One row (Open now · 24/7 · Free consultation · **More filters**). Distance, charge and language open on tap; the chip counts any that are on. |
| **Resources** | All 630 rows from every state | Opens on the person's state + national rows when their state is known; "All states" shows everything. Guests still see all rows. |
| **Icons** | Text triangles ▼▲ on 5 screens | Chevron icons. |
| **Logo** | Lettering unreadable at 32–50 px | At ≤ 56 px the octagon is cropped tighter, so the mark is about 30% larger. Design unchanged; the component says not to alter it. |
| **Plans** | The Case Pass card still listed "Bar exam prep" (missed in PR #3) | Filtered like the plan cards. |
| **Terms modal (bug found by the journeys)** | — | Bigger text made the summary 49 px taller than its box at 1280×900, so "I Agree" stayed locked with everything visible. "Seen it all" now also counts when the last real element is in view. Phones still have to scroll to the end. |

New strings, in all 8 languages: `home_more_options`, `home_show_all_tools`, `home_show_fewer_tools`, `hn_more_filters`, `hn_fewer_filters`, `res_my_state`, `onb_languages_sub`, `onboard_slide2_body`, `onboard_slide3_body`.

## Translation review (Nov 13)

The owner chose not to use native-speaker reviewers, so I reviewed every string added or changed in both branches (16 frontend keys and the backend `auth.err.password_weak`) in all 7 languages, against each file's own terms and register. 29 strings fixed:
- **Terminology** now matches each file: "criminal defense lawyer" in es / vi / ht / ar / tl, and "bail bondsman" in zh (保释担保人) and tl. The Haitian Creole "avoka kriminèl" could read as "a lawyer who is a criminal"; it's now "avoka defans kriminèl", the file's own term.
- **Register:** Tagalog strings use the polite *kayo / inyo*, like the other 946 strings in that file.
- **Clarity:**
  - vi "Thêm bộ lọc" (could read "add a filter") → "Bộ lọc khác".
  - ar "{state} + الوطنية" → "{state} + الموارد الوطنية".
- **Honesty:** "many offer a free consultation" → "many list one", as in English.
- **Chinese dashes:** the 158 strings that had "--" use the Chinese double dash "——" (no spaces) instead of " — ".
- **Tagalog Resources tab:** back to the file's established word, as **"Mapag\u00adkukunan"**. The escaped soft hyphen lets it break as "Mapag- / kukunan" in the 78 px tab. "Sanggunian" means "reference" in that file, and the chat text tells people to open "Mapagkukunan".

## Decisions (owner delegated, Nov 13)

- **Call 911 / Crisis 988 / SOS bar: kept** on every Home view, with the emergency card. Someone in a crisis must never have to look for it.
- **Logo: not redrawn.** The component says the design must not change, and the tighter crop at ≤ 56 px already makes it readable in headers.
- **The Emergency screen's "Send Emergency Alert" button** stays faded until contacts are added, as intended for a disabled state.
- **The Home footer** ("Available 24/7 · All 50 states + DC") stays: the app itself is available 24/7.

## Verification (machine and databases on America/New_York)

| Check | Result |
|---|---|
| Frontend type check, lint, design audit (`--ci`: 0 contrast failures in light and dark, 0 tap targets under 44 pt), nav targets | clean |
| Frontend tests | 884 + 408 pass (new: `typeScale`, Home layout, Get Help "More filters") |
| Backend lint and main suite | clean; 28,652 pass |
| Database suites | 574 / 574 |
| Smoke test (fresh database) | 44 / 44 |
| CI web journeys, run locally (production-mode API, AI stand-in, core and full builds) | All pass except E13, the same environment quirk as PR #3 (it fails on the untouched base build here too). The terms bug above was found and fixed during this run; `web-journeys` is 37 / 37 on both builds. |
| Real text sizes measured in the browser on 9 screens | all on the scale; 0 under 12 px |

## Applying it

The branch is on GitHub with a pull request into `sandbox-fixes-2026-11-12` (stacked on PR #3). Merge PR #3 first, and GitHub then retargets this one. The patches are in `PATCHES_UI/` (`git am`, applied after `PATCHES/`).
