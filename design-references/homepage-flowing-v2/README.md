# Boundra Homepage — Living Boundary v2

Alternative homepage direction created alongside the original `homepage-with-mascot` references. The earlier concept remains untouched.

This folder is design guidance only. It does not contain application or animation code.

## Concept

**Living Boundary** turns the mascot's segmented ring into a continuous path through the homepage. Intent enters the path, clarification branches it, the approved mandate stabilizes it, and evidence illuminates it.

The page should feel like one journey instead of a stack of presentation slides:

- Sections overlap and inherit shapes from the previous section.
- One ribbon/path connects the complete story.
- Backgrounds blend from ivory to sage to deep forest and back to ivory.
- Content attaches to the path instead of repeating equal-sized card grids.
- The mascot changes pose as the narrative advances.
- Large typography and open space create rhythm between detailed product moments.

## Reference files

| File | Purpose |
| --- | --- |
| `01-living-boundary-desktop-hero.png` | Alternative desktop hero and first section transition |
| `02-living-boundary-full-page.png` | Complete flowing desktop page narrative |
| `03-living-boundary-mobile.png` | Mobile adaptation of the continuous path |
| `04-living-boundary-motion-storyboard.png` | Four-stage motion and scroll storyboard |
| `MOTION.md` | Detailed animation and interaction instructions |

## Visual system

The approved color palette is unchanged:

| Role | Hex | Use |
| --- | --- | --- |
| Forest | `#122D27` | Primary type, navigation, evidence environment, buttons |
| Green | `#23674E` | Supporting controls and path depth |
| Ivory | `#F6F8F2` | Main canvas and mascot face |
| Sage | `#9BAF8D` | Boundary ribbon, borders, ambient fields |
| Lime | `#A6C74C` | Confirmed or positive accents only |
| Amber | `#D8A13B` | Caution, ineligible, and escalation only |
| Charcoal | `#19332D` | High-contrast details |

A faint pale sky blue may appear only as a non-semantic information-flow accent. It is not a new status color.

## Page flow

### 1. Arrival

- Minimal navigation floats over the hero environment.
- Headline: `Autonomy that knows where to stop.`
- Supporting copy: `Tell Boundra your goal. Define the limits. Keep the authority.`
- Actions: `Create your mandate` and `Explore the flow`.
- The mascot sits where its ring becomes the page ribbon.
- The intent field is embedded directly into the ribbon: `Manage 300 MockUSDC safely`.
- Disclosure remains visible: `Base Sepolia · Mock assets only`.

### 2. Guided journey

- The ribbon moves into the reading direction and carries the sequence `Intent → Boundaries → Action → Evidence`.
- Do not display four equal cards. Use staggered text moments attached to different turns in the path.
- Trust principles appear as landmarks: owner controlled, budget capped, targets allowlisted, evidence verifiable.

### 3. Clarification branch

- Heading: `Only ask what changes the action.`
- The ribbon divides into two paths only when a preference changes eligibility.
- Eligible uses green/sage. Ineligible uses amber.
- Example: `LiquidVault · Eligible` and `TimedVault · Not eligible · 30-day lockup`.
- The branches visibly originate from the same intent and reconnect after the result is explained.
- Unknown answers narrow authority or escalate; they never animate into an eligible state.

### 4. Mandate sheet

- Heading: `Your mandate, in plain sight.`
- Present the mandate as one large readable sheet crossing the ivory and sage environments.
- Required fields remain owner, operator, chain, token, target, actions, beneficiary, per-action limit, cumulative budget, expiry, and version.
- The mockup's generated wording and dates are illustrative. The implementation must use live or approved data.
- Do not show an open-ended mandate. The MVP default expiry is seven days and remains owner-editable before approval.

### 5. Evidence environment

- Heading: `Every action leaves evidence.`
- The background deepens into forest green without a hard section boundary.
- The sage ribbon becomes a thin lime trace only for a confirmed positive path.
- Stages may include `Policy checked`, `Broadcast`, and `Confirmed`.
- Broadcast is visually distinct from confirmed.
- HOLD, ESCALATE, rejection, pending, and reconciliation must use their real states and never receive a false success trace.

### 6. Closing loop

- The dark environment gradually returns to ivory.
- The ribbon curls back into the mascot's segmented ring.
- Heading: `Ready to define your boundaries?`
- Action: `Connect wallet`.
- The mascot uses a neutral guiding pose, not a confirmation pose.

## Layout guidance

### Desktop

- Use a 12-column grid as an alignment aid, but let the ribbon cross the grid.
- Alternate large text moments with focused product UI instead of repeated card rows.
- Allow some elements to overlap section transitions by 10–15% of the viewport height.
- Keep product text on flat, high-contrast surfaces even when the environment is dimensional.
- Limit mascot appearances to hero, clarification, evidence, and closing loop.

### Mobile

- Use one vertical ribbon as the primary reading guide.
- Keep the mascot and ribbon behind or beside text, never underneath body copy.
- Show one trust landmark at a time rather than a two-by-two grid.
- Place the intent field immediately after the hero copy.
- Preserve at least 44px control height and readable text at every breakpoint.
- Simplify scenery before reducing text contrast or control size.

## Image-generation notes

The images were made with the built-in image-generation tool using the approved Boundary Spirit model and interaction states as identity references.

- Desktop hero prompt: a cinematic, asymmetrical product hero where the boundary ring extends into a continuous ribbon and embeds the intent field.
- Full-page prompt: one connected scrollytelling environment with branching eligibility, a mandate sheet, a dark evidence passage, and a closing loop.
- Mobile prompt: the same ribbon converted into a vertical guided path without repeated card stacks.
- Storyboard prompt: four stages—Arrive, Guide, Clarify, Verify—with path traces and mascot state changes.

