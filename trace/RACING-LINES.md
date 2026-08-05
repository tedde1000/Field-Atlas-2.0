# Racing lines — the research, the measured defect, and the brief

**Status:** research + brief. No solver code changed by this document.
**Measured:** 2026-08-05, against `df40774` (v1.2.7), all six circuits in `data/atlas.js`
that carry a traced path.
**Instrument:** `trace/raceline-diag.mjs` — reproduces §03's solve outside the browser
and prints where the line sits at each phase of every corner. Run it before and after
any change to `racingLine()`.

---

# Part 0 — the one-paragraph version

Theodor: *"every circuit you have the wrong racing lines. It's not a natural racing
line … a default racing line from the outside, a wide line towards the inside apex of
the corner."*

He is right, and it is now measured rather than eyeballed. **The §03 line never goes
to the outside of the road. Not once, on any circuit, before any corner.** Averaged
over every numbered corner in the atlas, the line sits at **+0.32 to +0.56** of the
half-width *toward the inside kerb* on the approach — where a racing line sits at
**−0.9**. The "out" of out-in-out is entirely missing; what §03 draws is an
inside-biased smoothed centreline that touches a kerb 21–44 % of the lap.

The cause is not resolution, not the corridor width, and not the smoothing — all three
have been tried in previous sessions and none of them is it. **The cause is that stage 1
of `racingLine()` minimises *length*, not *curvature*, and stage 2 is a greedy local
search that cannot travel far enough to undo it.** Proof and numbers in Part 2.

---

# Part 1 — the research

## 1.1 What a racing line is

The racing line is the path through a corner that produces the lowest lap time — not
the shortest path, and not the smoothest path. Its defining property is that **it uses
the full width of the road in order to lengthen the radius of the turn**, because
cornering speed goes as `v = √(a_lat · R)`: a bigger radius is a higher speed for the
same grip. Wikipedia's definition is the canonical short form —

> In most cases, the line makes use of the entire width of the track to lengthen the
> radius of a turn: entering at the outside edge, touching the *apex* — a point on the
> inside edge — then exiting the turn by returning to the outside.

That is the "out–in–out" or "outside–inside–outside" line, and it is the shape the
figure is supposed to show.

**The four points every corner has** (this is the vocabulary the figure should be able
to name, and §03 currently only names one of them):

| point | what happens | where across the road |
|---|---|---|
| **braking point** | still straight, hard on the brakes | hard against the **outside**, ≈ −1.0 |
| **turn-in** | hands move, brakes releasing | still **outside**, ≈ −0.85 to −1.0 |
| **apex / clipping point** | closest approach to the inside kerb, minimum speed is at or just before it | **inside**, ≈ +0.95 to +1.0 |
| **exit / track-out** | throttle open, unwinding the wheel | back out to the **outside**, ≈ −0.85 to −1.0 |

(Signs throughout this document use the convention of the diagnostic tool: `+1` = hard
against the **inside** kerb of that corner, `−1` = hard against the **outside**, `0` =
on the centreline.)

The straight between two corners is where the line is genuinely *straight* — it runs
from the previous corner's track-out point to the next corner's turn-in point in a
straight diagonal, not down the middle and not along an edge. A racing line drawn
correctly is mostly **straight segments joined by a small number of long arcs**. This
matters enormously for how the figure reads: a line that is curving everywhere looks
like a smoothed centreline no matter how well-argued its curvature is.

Sources: [Wikipedia — Racing line](https://en.wikipedia.org/wiki/Racing_line) ·
[Driver61 — How to drive the perfect racing line](https://driver61.com/uni/racing-line/) ·
[Drivingfast.net — turn-in, apex, exit](https://drivingfast.net/racing-line/) ·
[NCR-PCA — Anatomy of a Corner](https://ncr-pca.org/index.php/club-activities/driver-education/44-anatomy-of-a-corner)

## 1.2 The kinds of racing line

There is not one racing line. There are three named lines through the same piece of
tarmac, and which one is correct depends on what follows the corner.

### (a) The geometric line — geometric apex

The largest circle that fits inside the corridor. It apexes at the **geometric middle**
of the inside kerb, uses every inch of road at entry and exit, and has the single
largest possible constant radius. It gives **the highest minimum speed** through the
corner and can in principle be driven at constant speed from turn-in to exit.

It is the right line only where corner exit does not matter: a fast sweeper, or a corner
followed immediately by another corner rather than by a straight.

Rule of thumb from the coaching literature: *the faster the corner, the closer to the
geometric line you should drive.*

### (b) The classic / ideal line — late apex

Turn in **later** than the geometric line, take a **tighter** radius from turn-in to
apex, clip the inside **past** the geometric middle, and then **open the exit radius**
so the car is already close to straight when the throttle goes down.

This is slower into the corner and slower at the apex, and faster everywhere after it.
The trade is explicit: entry speed is *given away* to buy exit speed, and exit speed is
then carried for the whole length of the following straight. A tenth lost at turn-in is
repaid several times over 400 m later. Ross Bentley's formulation — *"exit speed is
king"* — is the standard coaching statement of it.

Use it on: **hairpins**, **slow corners**, and above all **any corner that leads onto a
long straight**. The single most important corner on any circuit is the one before the
longest straight, and it gets the latest apex on the lap.

### (c) The early apex

Apex before the geometric middle. Almost always a mistake — it forces the driver to
tighten the radius on exit, which is the one place the car has least grip left because
it is already using it for acceleration. It runs the car out of road at the exit.

It is legitimate in exactly one case: an **increasing-radius** corner (see below), where
the road itself opens up on exit and the early apex is simply following it.

Sources: [SimRacingCockpit — Racing line explained: late vs geometric apex](https://simracingcockpit.gg/racing-line/) ·
[Speed Secrets — The late apex explained](https://speedsecrets.com/the-late-apex-explained/) ·
[Winding Road — Speed Secrets: the virtues of early and late apexing](https://windingroad.com/articles/features/speed-secrets-the-virtues-of-early-and-late-apexing-explained/) ·
[Winding Road — determining entry/exit speed balance](https://windingroad.com/articles/features/speed-secrets-determining-entry-exit-speed-balance/) ·
[KartClass — The different types of apex](https://kartclass.com/blogs/news/the-different-types-of-apex) ·
[SimRacing-Pro — early vs late apex](https://simracing-pro.com/what-is-apex/)

## 1.3 The corner archetypes, and the line each one gets

`cornerArchetypes()` in `js/loop.js` already names five of these. The names are correct;
what follows is what each one's *line* should look like, which is the part §03 does not
currently express.

| archetype | the road | the line |
|---|---|---|
| **constant radius** | radius unchanging through the turn | geometric apex if it feeds another corner; slightly late if it feeds a straight |
| **increasing radius** (opens on exit) | tight in, opens out | **early apex** — the only case where early is right. Get the car turned while the road is tight, then run out with the opening radius |
| **decreasing radius** (tightens on exit) | open in, tightens | **very late apex**, and a slow one. Brake deeper, turn in later than instinct says; the exit is a passenger |
| **hairpin** | 150–180°, tightest radius on the circuit | **the latest apex of all**. Wide entry, a deliberately tight arc to a late clipping point, then a long straight-line exit. Visually the most dramatic out-in-out on the lap |
| **double apex** | two clipping points, one turn (a long constant-radius corner entered and exited on the same side) | wide in, clip, **drift out to mid-track between the two apexes**, clip again, track out. The middle of a double apex is the one place a line legitimately leaves the inside and comes back |
| **linked / compound corners, esses, chicanes** | two or more corners within a car-length or two of each other | solved as a *unit*. Whichever corner feeds the straight wins; the earlier ones are sacrificed. **Do not track out of the first corner** — you would arrive on the wrong side for the second |
| **chicane** | tight alternating pair | straightened as far as the kerbs allow — the line is close to a diagonal through both, not two arcs |

The chicane/linked rule is the one that most often looks "wrong" to a viewer who is
expecting textbook out-in-out everywhere, so it is worth being explicit in the figure's
legend rather than silently producing it.

Sources: [iRacing wiki — asphalt road corner types](https://iracing.fandom.com/wiki/Asphalt_Road_and_Dirt_Road_Corner_Types) ·
[Motorsport Prospects — the 7 technical corner types](https://www.motorsportprospects.com/the-7-technical-corner-types-in-racing/) ·
[FlowRacers — different types of corners in F1](https://flowracers.com/blog/f1-corner-types/) ·
[KartClass — types of corners in racing](https://kartclass.com/blogs/track-guides/types-of-corners-in-racing) ·
[TeamSport — understanding the racing line (karting)](https://www.team-sport.co.uk/go-karting-faqs/understanding-the-racing-line) ·
[Formula1-dictionary — corners](https://www.formula1-dictionary.net/corners.html)

## 1.4 Why the shape is what it is — the physics

Three facts generate everything above.

1. **`v = √(a_lat · R)`.** Cornering speed rises with the square root of radius. Using
   the full width of a `w`-wide road through a `θ`-radian corner of centreline radius
   `R` raises the achievable radius to roughly `R + w/(2·(1 − cos(θ/2)))` — which is why
   the gain from going wide is enormous on a hairpin and small on a gentle kink. *This
   is also why the drawn corridor width is not a cosmetic choice: it sets how much
   lateral movement there is to show.*

2. **The friction circle.** Lateral and longitudinal grip come out of the same budget.
   You cannot corner at the limit and accelerate at the limit simultaneously — so the
   exit is a *trade*: the straighter the car, the more of the budget is available for
   throttle. A late apex converts steering angle into throttle earlier.

3. **Asymmetry of payoff.** Time lost at entry is lost over the length of the entry
   phase (tens of metres). Speed gained at exit is carried for the whole following
   straight (hundreds of metres) and is squared into the time saved. That asymmetry is
   the whole justification of the late apex, and it is exactly what `racingLine()`'s
   `BACK`/`FWD` window was rewritten to see — correctly.

**Trail braking** is the technique that makes a late apex drivable: the brakes are
released progressively *into* the corner rather than before turn-in, so the front axle
keeps load and the car rotates. It is why the line's minimum speed sits **at or slightly
before** the apex, not at the geometric middle. §03's flow already paces off
`speedProfile()` rather than curvature, which is the right call and should be kept.

Sources: [Speed Secrets — trail braking stories](https://rossbentley.substack.com/p/speed-secrets-trail-braking-stories) ·
[Physics of Formula 1 — the racing line](https://physicsofformula1.wordpress.com/the-racing-line/) ·
[trophi.ai — the racing line](https://www.trophi.ai/post/the-racing-line-the-technique-your-sim-setup-cant-teach-you)

## 1.5 The maths — three objectives, three different shapes

This is the section that matters most for the code, because §03 is currently solving the
wrong one of these while believing it solves another.

| objective | what it minimises | what it looks like | is it a racing line? |
|---|---|---|---|
| **shortest path** | `∫ ds` — path length | hugs the inside kerb *continuously*, cuts every corner, apexes early, is a taut string with kinks where it leaves the kerb | **no.** It is what a piece of string does |
| **minimum curvature** | `∫ κ² ds` | out–in–out, geometric apex, straight on the straights, largest radius through every corner | **very nearly.** This is the standard racing-line generator |
| **minimum time** | lap time under a speed model | minimum curvature, pushed later at the apexes that feed straights | **yes** — but it needs the whole vehicle model and much more computation |

The literature is unambiguous about the first two:

> The shortest path reduces lap time by space minimization but results in lower speed at
> turns, while the minimum curvature path reduces lap time by offering higher speed at
> turns but results in a longer path. The shortest path does not offer minimum lap time
> for curved race tracks as the speed is reduced considerably at turns.

and about the last two:

> The minimum curvature line is quite near to a minimum time line in corners but will
> differ as soon as the car's acceleration limits are not exploited.

TUM's `global_racetrajectory_optimization` is the reference implementation and offers all
three (`shortest_path`, `mincurv`, `mincurv_iqp`, `mintime`) over exactly the
representation §03 already uses — a lateral offset `α` per node about a reference line,
bounded by the track width. Their minimum-curvature solve is a **quadratic program**
minimising the squared second derivative of the position, iterated to beat the
linearisation error in tight corners. That is the shape §03's stage 1 is supposed to be.

**The critical distinction, and the bug:** minimising `∫ κ² ds` requires a **fourth-order**
(biharmonic, `[1, −4, 6, −4, 1]`) update. Moving each node toward the **midpoint of its
neighbours** — the second-order Laplacian, `[1, −2, 1]` — is *not* that. It is the
discrete heat equation on the curve, i.e. **curve-shortening flow**, whose fixed point on
a closed loop is the shortest curve, and inside a corridor is **the shortest path in that
corridor**. Same stencil, completely different answer.

Sources: [TUMFTM/global_racetrajectory_optimization](https://github.com/TUMFTM/global_racetrajectory_optimization) ·
[Heilmeier et al., *Minimum curvature trajectory planning and control for an autonomous race car*, Vehicle System Dynamics 58(10)](https://www.tandfonline.com/doi/full/10.1080/00423114.2019.1631455) ·
[arXiv 2203.03224 — A fast approach to minimum curvature raceline planning](https://arxiv.org/abs/2203.03224v1) ·
[Sci. Rep. — Global minimum time trajectory planning considering curvature and distance](https://www.nature.com/articles/s41598-025-21211-2) ·
[Wikipedia — Curve-shortening flow](https://en.wikipedia.org/wiki/Curve-shortening_flow) ·
[Wikipedia — Euler spiral / clothoid](https://en.wikipedia.org/wiki/Euler_spiral) ·
[UIUC dynamics reference — track transition curves](https://dynref.engr.illinois.edu/avt.html)

## 1.6 One more thing the figure should borrow: the clothoid

A real turn-in is not an instantaneous jump from radius ∞ to radius `R`. The steering
wheel takes about half a second to wind on, so curvature rises roughly **linearly with
distance** — which is a **clothoid** (Euler spiral), the same transition curve used
between straight and curved railway track for the same reason. Drawing turn-in and
track-out as clothoid transitions rather than as tangent arcs is the single cheapest
thing that makes a hand-constructed racing line read as *driven* rather than *drawn*.

---

# Part 2 — what §03 actually draws, measured

Run `node trace/raceline-diag.mjs` to reproduce all of this.

## 2.1 The phase table — the headline evidence

Position of the solved line, averaged over every numbered corner.
**`+1` = hard against the inside kerb · `−1` = hard against the outside kerb.**
"pre-corner" is sampled 2 % of a lap before the corner run begins — i.e. on the approach,
where a racing line should be hard against the outside.

| circuit | pre-corner | turn-in | apex | track-out |
|---|---|---|---|---|
| **what a racing line does** | **−0.90** | **−0.85** | **+0.95** | **−0.85** |
| rasbo | **+0.50** | +0.04 | +0.53 | +0.11 |
| halla | **+0.34** | +0.55 | +0.84 | +0.73 |
| enkoping | **+0.56** | +0.44 | +0.81 | +0.57 |
| jarfalla | **+0.42** | +0.34 | +0.75 | +0.28 |
| linkoping | **+0.32** | +0.12 | +0.97 | +0.60 |
| gellerasen | **+0.50** | +0.14 | +0.59 | +0.31 |

Every single number in the pre-corner column has the **wrong sign**. The line approaches
every corner on the *inside*. Every number in the track-out column has the wrong sign
too — it exits toward the inside as well. The apex column is the only one that is even
directionally right, and on two circuits it does not reach the kerb at all.

Supporting numbers from the same run:

| circuit | corners | fraction of lap pinned on a kerb | worst joint in the drawn line | apex position within its corner |
|---|---|---|---|---|
| rasbo | 12 | **31 %** | 9.6° | 0.50 (geometric) |
| halla | 8 | **44 %** | 8.6° | 0.57 |
| enkoping | 8 | **29 %** | 7.3° | 0.65 |
| jarfalla | 13 | **34 %** | **56.6°** | 0.51 (geometric) |
| linkoping | 12 | **21 %** | 6.8° | 0.62 |
| gellerasen | 9 | **37 %** | 9.6° | 0.59 |

A racing line touches a kerb at the apex and at track-out and nowhere else — call it
5–10 % of a lap. **21–44 % is a string pulled tight, not a driven line.** And Järfälla
still has a **56.6° joint** in the drawn line, which is a visible corner *in the line
itself* at a node spacing under a metre.

## 2.2 Root cause 1 — stage 1 minimises length, not curvature

`js/loop.js`, inside `racingLine()`, stage 1:

```js
const lx = (ax + bx) / 2 - cx, ly = (ay + by) / 2 - cy;
d[i] = clampAt(i, d[i] + relax * (lx * nx[i] + ly * ny[i]));
```

Each node steps toward the **midpoint of its two neighbours**. That is Laplacian
smoothing — the discrete heat equation on the curve — and on a **closed** loop it is
curve-shortening flow. Its unconstrained fixed point is a point; its box-constrained
fixed point is the **shortest closed curve inside the corridor**. Which is precisely what
the phase table above describes: a line glued to the inside of everything.

The header comment above stage 1 says it "relaxes … toward minimum curvature". It does
not. The comment further down even notices the symptom —

> *"A taut string apexes early and turns in kinks where it leaves the kerb."*

— and then applies three `[1 2 1]` passes to the offsets, which rounds off the corners of
the shortest path but does not change which curve it converged to. **The diagnosis was
one line away and the fix was applied to the wrong layer.**

Minimising `∫ κ² ds` means minimising `Σ |P₍ᵢ₋₁₎ − 2Pᵢ + P₍ᵢ₊₁₎|²`, whose gradient is the
**biharmonic** `[1, −4, 6, −4, 1]`, not the Laplacian `[1, −2, 1]`.

**Proven, not asserted.** Swapping only that stencil — same corridor, same clamps, same
node count, same coarse-to-fine schedule, projected-gradient instead of Jacobi — flips
the approach position from inside to outside:

| circuit | | pre-corner | turn-in | apex | track-out |
|---|---|---|---|---|---|
| rasbo | shipped (Laplacian) | **+0.50** | +0.04 | +0.53 | +0.11 |
| rasbo | biharmonic | **−0.40** | −0.02 | +0.59 | +0.01 |
| gellerasen | shipped (Laplacian) | **+0.50** | +0.14 | +0.59 | +0.31 |
| gellerasen | biharmonic | **−0.52** | +0.21 | +0.73 | +0.16 |

The sign flip on the approach is the entire "goes wide" behaviour appearing, from a
one-stencil change. See `trace/raceline-diag.mjs --compare`, and the rendered overlay it
writes.

**Do not over-read this.** The crude biharmonic prototype is *slower on the stopwatch*
than what ships today (rasbo 49.9 s vs 46.7 s under `speedProfile()`; centreline 49.5 s).
It is unconverged, and minimum curvature is not minimum time. The point is narrower and
firmer: **the shipped stage-1 solves a different problem from the one its comment claims,
and the difference is exactly the missing wide entry.** Stage 2 is then asked to fix it
and can't.

## 2.3 Root cause 2 — stage 2 is a local search starting from the worst possible guess

Stage 2 is right in *concept* — the `BACK`/`FWD` window rewrite is correct and well
argued, and it is what makes the apexes late at all. But:

- it starts from the **shortest path**, which is the slowest line in the corridor and the
  furthest from the answer;
- it is **greedy** — a raised-cosine bump is accepted only if it improves the local time
  immediately, so it cannot cross a ridge;
- its largest step is `w × 0.25`, decaying by 0.55 per stage over 5 stages. Total
  reachable travel from a single node's sweeps is well under the corridor width, so it
  **cannot walk from the inside kerb to the outside kerb even if it wanted to**;
- `relieve()` multiplies `d` by 0.82 whenever a segment compresses, which **pulls the
  line back toward the centreline** — and segment compression happens on the inside of
  tight corners, i.e. exactly where a real apex is.

The `gain` it reports (6.5–13.1 s) looks impressive and is actually the tell: a stage-2
that has to find *thirteen seconds* is not polishing a good starting line, it is
rescuing a bad one, and it runs out of travel before it gets there.

## 2.4 What is **not** the cause

Recorded so these are not re-litigated — previous sessions already tried them and the
notes in `js/circuit.js` are correct:

- **Not resolution.** 2 600 nodes is plenty; the defect is identical at any density.
- **Not the corridor width.** Solving at true track width and magnifying was tried,
  measured, and is wrong for the reasons in the `CORRIDOR_CAP` note. The exaggerated
  corridor is a correct drawing decision.
- **Not the smoothing.** More `[1 2 1]` passes round the shortest path; they do not move
  it.
- **Not the fold clamp.** It bounds inward offset and has nothing to say about a line
  that refuses to go outward.
- **Not the corner classifier.** `cornerArchetypes()` is sound and is not consulted by
  the solver, deliberately and correctly.

---

# Part 3 — the brief

> Paste from here down into Claude Code, opened at the repo root, on branch
> `claude/atlas-racing-lines-research-upaks5`.

## The job

§03's racing line does not go wide. Make it a racing line. Read Parts 1 and 2 of
`trace/RACING-LINES.md` first — the research and the measurements are already done, and
Part 2.4 lists five things that have been tried and are *not* the cause. Do not repeat
them.

## Non-negotiables (unchanged from `PROMPT.md`)

1. No build step, no packages, ES modules only. Colours from `assets/tokens.css`.
2. `node trace/verify.mjs` must be green before you say you are done, and **add checks
   for everything you fix**.
3. Never hand-edit `data/atlas.js` or `data/world.js`.
4. `js/loop.js` is shared by four surfaces (§02 thumbnail, §03 figure, §04 catalogue
   cell, panel hero). Anything you change there changes all of them.
5. Ask before committing or pushing.

## The recommended approach

Keep the two-stage architecture. Fix stage 1, then give stage 2 a start it can work from.

### Step 1 — make stage 1 an actual minimum-curvature solve

Replace the Laplacian midpoint step with a projected-gradient step on
`E = Σ |P₍ᵢ₋₁₎ − 2Pᵢ + P₍ᵢ₊₁₎|²`, i.e. the biharmonic `[1, −4, 6, −4, 1]` applied to the
offset positions and projected onto each node's normal. Keep the coarse-to-fine `k`
schedule — it is correct and it is what makes this affordable. Keep `clampAt()`.

Step size: the biharmonic stencil's spectral radius is 16, so `α ≲ 0.05` per sweep is
stable; the prototype used `α = 0.045` and converged in ~900 sweeps per scale. If that is
too slow at 2 600 nodes, a Gauss–Seidel or a small local QP per node is fine — the
objective is what matters, not the solver.

Better still, if you want the reference formulation rather than a hand-rolled descent:
TUM's `mincurv` is a QP over exactly this variable (`opt_min_curv.py` in
[TUMFTM/global_racetrajectory_optimization](https://github.com/TUMFTM/global_racetrajectory_optimization)),
including the iterative re-linearisation (`mincurv_iqp`) that fixes the curvature
approximation in tight corners. Port the *formulation*; do not add a dependency.

**Fix the comment while you are there.** The current one claims minimum curvature and
delivers minimum length, and that comment is why nobody caught this for three sessions.

### Step 2 — let stage 2 travel

- Give the descent a first stage whose step is at least `w × 0.6`, so a bump can cross
  the corridor.
- Consider seeding: evaluate both the min-curvature line *and* a constructed out-in-out
  line (below) and let the time model pick per corner. Cheap, and it turns a greedy
  search into a two-start one.
- Make `relieve()` stop pulling toward the centreline. Relieve compression by easing the
  offsets of the *neighbouring* nodes along the line, not by shrinking `|d|` — shrinking
  `|d|` deletes the apex to fix a segment length, which is the wrong trade.

### Step 3 — if the solver still will not draw a figure that reads correctly, construct it

This is a **figure on a website**, not a lap-time simulator, and it is allowed to be
constructed as long as it is constructed from measured geometry. If Steps 1–2 leave it
ambiguous, add a soft target profile:

1. Take the corner runs `numberedCorners()` already finds, and their archetypes from
   `cornerArchetypes()` — both are already correct.
2. Build a target offset `d*(s)`: `−1` (outside) at the braking point, `−0.9` at
   turn-in, `+1` (inside kerb) at the apex, `−0.9` at track-out, and **free** on the
   straights.
3. Place the apex by archetype, as a fraction along the corner run — `hairpin` 0.70,
   `decreasing` 0.68, `classic` 0.60, `constant` 0.55, `increasing` 0.40,
   `linked` = whatever positions the car for the next corner (do **not** track out of the
   first corner of a linked pair — see §1.3).
4. Ramp between control points as a **clothoid** (curvature linear in arc length), not a
   tangent arc — see §1.6.
5. Add `λ · Σ (dᵢ − d*ᵢ)²` to the stage-1 objective with `λ` small enough that the
   curvature term still shapes the corners. Then run stage 2 on top so the stopwatch
   still gets the last word on apex placement.

This gives a figure that is guaranteed to read as a racing line at every zoom *and* is
still derived from the traced geometry — nothing hand-authored per circuit.

## Acceptance criteria — add every one of these to `trace/verify.mjs`

Measured by `trace/raceline-diag.mjs`, across all circuits in `data/atlas.js` that carry
a path. Current values in brackets.

| # | check | target |
|---|---|---|
| 1 | mean pre-corner position | **≤ −0.55** (now +0.32 … +0.56) |
| 2 | pre-corner position, per corner, for corners preceded by ≥3 % of a lap without a corner | **≤ −0.30 on ≥ 80 % of them** (now ~0 %) |
| 3 | mean apex position | **≥ +0.85** (now +0.53 … +0.97) |
| 4 | mean track-out position, for corners followed by a straight | **≤ −0.40** (now +0.11 … +0.73) |
| 5 | fraction of lap pinned within 1.5 % of a kerb | **≤ 12 %** (now 21 … 44 %) |
| 6 | sharpest joint in the drawn line | **< 20°** (now up to 56.6° at Järfälla) — tighten the existing `< 25` check |
| 7 | mean apex position within its corner run | **≥ 0.55**, and ≥ 0.62 for corners classified `hairpin` or `decreasing` (now 0.50 … 0.65) |
| 8 | existing `swing` checks | keep — `> 0.55` and `≤ 1.001` |
| 9 | lap time under `speedProfile()` | **must not get slower** than what ships today, per circuit |
| 10 | solve time | **< 400 ms** per circuit on the 2 600-node path |

Checks 1, 2 and 4 are the ones that encode "from the outside, wide, to the inside apex".
They are the reason this document exists. If a future change makes any of them regress,
the figure has gone back to drawing a smoothed centreline.

## Visual check, not just numeric

`trace/raceline-diag.mjs` writes an SVG per circuit and a `--compare` overlay. Render them
and **look at them** before declaring done. The failure mode this document is about is one
that every numeric check in the suite passed for three sessions: `swing = 1.00` and
`kink < 25°` were both green on a line that never went wide.

---

## All sources, in one place

**Driving technique**
- [Wikipedia — Racing line](https://en.wikipedia.org/wiki/Racing_line)
- [Driver61 — How to drive the perfect racing line](https://driver61.com/uni/racing-line/)
- [Drivingfast.net — Driving the racing line: turn-in, apex, exit](https://drivingfast.net/racing-line/)
- [SimRacingCockpit — Racing line explained: late vs geometric apex (with diagrams)](https://simracingcockpit.gg/racing-line/)
- [SimRacingCockpit — How to drive the best racing line](https://simracingcockpit.gg/how-to-drive-the-best-racing-line/)
- [Speed Secrets — The late apex explained](https://speedsecrets.com/the-late-apex-explained/)
- [Speed Secrets — Trail braking stories](https://rossbentley.substack.com/p/speed-secrets-trail-braking-stories)
- [Winding Road — Speed Secrets: the virtues of early and late apexing explained](https://windingroad.com/articles/features/speed-secrets-the-virtues-of-early-and-late-apexing-explained/)
- [Winding Road — Speed Secrets: determining entry/exit speed balance](https://windingroad.com/articles/features/speed-secrets-determining-entry-exit-speed-balance/)
- [NCR-PCA — Anatomy of a Corner](https://ncr-pca.org/index.php/club-activities/driver-education/44-anatomy-of-a-corner)
- [trophi.ai — The racing line](https://www.trophi.ai/post/the-racing-line-the-technique-your-sim-setup-cant-teach-you)
- [TrackTitan — Racing line: hitting the apex](https://www.tracktitan.io/study-plans/b3a97222-e0c7-4e06-9ca4-a5a8adc9fb81-hitting-the-apex)

**Corner types and apexes**
- [KartClass — The different types of apex](https://kartclass.com/blogs/news/the-different-types-of-apex)
- [KartClass — Types of corners in racing](https://kartclass.com/blogs/track-guides/types-of-corners-in-racing)
- [SimRacing-Pro — What is the apex? Early vs late apex explained](https://simracing-pro.com/what-is-apex/)
- [iRacing wiki — Asphalt road and dirt road corner types](https://iracing.fandom.com/wiki/Asphalt_Road_and_Dirt_Road_Corner_Types)
- [Motorsport Prospects — The 7 technical corner types in racing](https://www.motorsportprospects.com/the-7-technical-corner-types-in-racing/)
- [FlowRacers — Different types of corners in F1](https://flowracers.com/blog/f1-corner-types/)
- [Formula1-dictionary — Corners](https://www.formula1-dictionary.net/corners.html)
- [TeamSport — Understanding the racing line (karting)](https://www.team-sport.co.uk/go-karting-faqs/understanding-the-racing-line)

**The maths**
- [TUMFTM/global_racetrajectory_optimization](https://github.com/TUMFTM/global_racetrajectory_optimization) — reference implementation, all four objectives
- [Heilmeier et al. — Minimum curvature trajectory planning and control for an autonomous race car, *Vehicle System Dynamics* 58(10), 2020](https://www.tandfonline.com/doi/full/10.1080/00423114.2019.1631455)
- [arXiv 2203.03224 — A fast approach to minimum curvature raceline planning via probabilistic inference](https://arxiv.org/abs/2203.03224v1)
- [*Scientific Reports* — Global minimum time trajectory planning considering curvature and distance for track racing](https://www.nature.com/articles/s41598-025-21211-2)
- [Wikipedia — Curve-shortening flow](https://en.wikipedia.org/wiki/Curve-shortening_flow) — why the Laplacian step is a length solver
- [Wikipedia — Euler spiral](https://en.wikipedia.org/wiki/Euler_spiral) and [UIUC — track transition curves](https://dynref.engr.illinois.edu/avt.html) — clothoid turn-in
- [Physics of Formula 1 — The racing line](https://physicsofformula1.wordpress.com/the-racing-line/)
