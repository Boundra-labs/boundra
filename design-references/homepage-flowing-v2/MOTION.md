# Living Boundary Motion Specification

Motion should explain the relationship between intent, permission, action, and evidence. It should never be ornamental enough to distract from financial status or imply that an unconfirmed action succeeded.

No animation code has been created. These are implementation instructions for a later phase.

## Motion principles

1. **Continuous:** the same ribbon connects sections and preserves orientation.
2. **Purposeful:** movement reveals causality, eligibility, or state.
3. **Calm:** no bouncing interfaces, constant particle storms, or rapid parallax.
4. **Interruptible:** scrolling and interaction always remain under user control.
5. **Truthful:** visual success occurs only after the underlying state is confirmed.

## Timing language

| Motion | Duration | Character |
| --- | ---: | --- |
| Button and link feedback | 140–180ms | Crisp |
| Small status change | 220–320ms | Clear |
| Card or field reveal | 350–500ms | Gentle |
| Mascot pose transition | 450–650ms | Soft |
| Hero entrance | 700–900ms | Composed |
| Ambient loop | 5–8s | Nearly still |

Use a smooth ease-out for entrances and an ease-in-out for path morphing. Avoid elastic or spring-heavy motion in authority and transaction states.

## 1. Page arrival

Sequence after the first meaningful paint:

1. Navigation and hero copy fade in with a subtle 12–20px upward movement.
2. The mascot resolves from soft opacity without scaling from zero.
3. The ring's front segments open by a few degrees.
4. The sage ribbon draws outward from the ring toward the intent field.
5. The primary action becomes fully opaque last.

Keep the complete entrance under 900ms. The headline should be readable immediately and must not wait for the mascot animation.

## 2. Hero idle motion

- Mascot body: extremely subtle breathing movement over 6–8 seconds.
- Ring: less than 2 degrees of slow counter-motion.
- Ribbon: soft highlight travels across no more than once every 8 seconds.
- Information particles: optional; use two or three at most and stop them while the user interacts.
- Do not animate headline text continuously.

## 3. Scroll-linked ribbon

- Reveal the ribbon progressively according to scroll position.
- The next content landmark becomes visible shortly before the ribbon reaches it.
- Keep the path direction aligned with the reading direction.
- Avoid tying every pixel of animation directly to scroll; use short settled states at each landmark.
- On fast scrolling, snap safely to the nearest completed state rather than replaying every transition.

Suggested narrative checkpoints:

- 0–15%: arrival and intent.
- 15–35%: trust boundaries.
- 35–55%: clarification and eligibility.
- 55–72%: mandate preview.
- 72–90%: evidence.
- 90–100%: closing loop and CTA.

## 4. Mascot choreography

- Hero: neutral guide, one hand near the path.
- Trust journey: the mascot may travel a short distance with the ribbon, then remain anchored while content passes.
- Clarification: transition to the thinking pose after the question is visible.
- Ineligible result: use one amber attention pulse; never show panic or repeated flashing.
- Mandate: neutral presenting pose.
- Confirmed evidence: success pose only after confirmed state is available.
- Closing CTA: return to the neutral/welcome pose.

Use a crossfade or short pose morph. Do not rotate or spin the mascot between states.

## 5. Clarification branch

1. The single ribbon slows at the clarification question.
2. It divides into green and amber branches.
3. Both candidate outcomes remain visible while evaluation occurs.
4. The eligible branch gains a restrained lime edge highlight.
5. The ineligible branch stops and receives one amber pulse with its reason.
6. The selected branch reconnects to the main path; the other stays visible long enough to understand the comparison.

Do not make the ineligible branch disappear immediately. The contrast is part of the product explanation.

## 6. Mandate preview

- The mandate sheet should rise slightly from the ribbon and rotate into a flat readable plane.
- Reveal fields from top to bottom with 50–70ms stagger.
- Changed constraints briefly receive a sage background wash, then settle.
- If the preview changes after an answer, animate only changed fields.
- Approval controls remain still until all required data is loaded.

## 7. Evidence passage

- Transition the environment from sage to forest over roughly one viewport of scroll.
- Policy checked: illuminate the first node in green.
- Broadcast: animate a traveling dot, but do not turn the full path lime.
- Confirmed: complete the trace in lime and show the confirmation marker once.
- Pending: maintain a slow neutral pulse without moving forward.
- Failed or rejected: stop the trace and show the reason in amber or error styling.
- Reconciliation: use a soft back-and-forth scan on the current segment; never restart from the beginning.

## 8. Controls and microinteractions

- Primary button hover: darken slightly and move the arrow 3–4px.
- Secondary link hover: extend its underline along the reading direction.
- Focus: use a persistent high-contrast lime or forest outline; never rely on motion alone.
- Intent field focus: the nearby ribbon brightens subtly, without moving the layout.
- Navigation anchors: use smooth but short scrolling and update the active section only after it enters the primary reading area.
- Avoid hover-only information; every state must work with keyboard and touch.

## 9. Reduced motion

When reduced motion is requested:

- Render the complete ribbon statically.
- Replace parallax and path drawing with simple opacity changes under 150ms, or no transition.
- Use one static mascot pose per section.
- Show eligibility branches and evidence stages immediately.
- Disable ambient breathing, floating particles, and traveling highlights.
- Preserve all copy, status, and hierarchy without animation.

## 10. Performance and accessibility guardrails

- Prioritize transforms and opacity for moving layers.
- Keep the hero headline and primary action outside any animation dependency.
- Reserve layout space before assets load to prevent shifting.
- Do not autoplay heavy video for the ribbon or mascot.
- Pause ambient motion when the page is hidden or offscreen.
- Never flash more than once for warning or success.
- Do not use color or motion as the only carrier of status; pair both with text and icons.
- Maintain contrast over every background transition.

