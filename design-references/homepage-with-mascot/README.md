# Boundra Homepage with Boundary Spirit

Design reference pack for the Boundra public homepage. These files are visual references only and are not wired into the application.

Generated mockup text is illustrative. The approved copy and product-state rules in this document are the source of truth for implementation.

## Reference files

| File | Purpose |
| --- | --- |
| `01-homepage-desktop-hero.png` | Primary desktop viewport and visual direction |
| `02-homepage-full-page.png` | Complete desktop narrative and section order |
| `03-homepage-mobile.png` | Mobile hierarchy and stacking behavior |
| `04-homepage-sections-components.png` | Reusable homepage sections, controls, cards, and mascot placements |

## Design direction

The homepage is a trust-first editorial fintech experience. It should feel calm, inspectable, and self-custodial rather than speculative or trading-oriented.

- Warm ivory canvas with soft white surfaces.
- Deep forest typography and controls.
- Sage borders and quiet atmospheric shapes.
- Lime is reserved for positive confirmation.
- Amber is reserved for caution, risk, or owner attention.
- Large editorial serif headlines paired with a highly legible sans-serif UI face.
- Generous whitespace, thin rules, restrained shadows, and rounded rectangular cards.
- No market charts, token-price language, coins, shields, robots, or generic blockchain imagery.

## Homepage structure

### 1. Navigation

- Wordmark: `boundra`
- Badge: `TESTNET`
- Links: `How it works`, `Safety`, `Evidence`, `Docs`
- Primary action: `Connect wallet`

The testnet badge remains visible on desktop and mobile. Connecting a wallet must not be described as authorizing a mandate or moving funds.

### 2. Hero

Eyebrow:

> YOUR INTENT. YOUR AUTHORITY.

Headline:

> Autonomy within your boundaries.

Supporting copy:

> Delegate MockUSDC management with explicit limits, deterministic enforcement, and evidence you can verify.

Actions:

- Primary: `Create your mandate`
- Secondary: `See how it works`

Disclosure:

> Base Sepolia · Mock assets only

The Boundary Spirit appears on the right on desktop and below the hero copy on mobile. Three abstract cards communicate `Intent`, `Boundaries`, and `Evidence`. The mascot guides the cards through its ring; it does not grant authority.

### 3. Trust strip

1. **Owner controlled** — Only you can authorize, replace, pause, or revoke a mandate.
2. **Budget capped** — Every action stays within the amount you approved.
3. **Targets allowlisted** — The agent can only use reviewed targets and actions.
4. **Verifiable evidence** — On-chain actions include real status and receipt evidence.

### 4. Workflow

Section heading:

> How Boundra works

Supporting motif:

> Intent → Boundaries → Action → Evidence

Steps:

1. **Share your goal** — Tell Boundra what you want to manage and the amount involved.
2. **Answer what matters** — Clarify only the preferences that could change the available action.
3. **Review your mandate** — Inspect the target, actions, budget, expiry, and owner controls.
4. **Approve and monitor** — Authorize explicitly, fund separately, and follow every decision.

### 5. Preference and eligibility comparison

Section heading:

> Same goal. Different boundaries.

Supporting copy:

> Boundra asks about preferences only when the answer can change what the agent is allowed to do.

Example intent:

> Manage 300 MockUSDC safely.

Example clarification:

> Could you need access to these funds within the next 30 days?

Example result when liquidity is required:

- `LiquidVault` — `Eligible` — No lockup; matches the liquidity requirement.
- `TimedVault` — `Not eligible · 30-day lockup` — Conflicts with the liquidity requirement.

Unknown answers narrow authority or lead to escalation. They never silently make an option eligible.

### 6. Mandate preview

Section heading:

> Your mandate, in plain sight.

Required preview fields:

- Owner and operator
- Base Sepolia chain
- MockUSDC token
- Eligible target
- Allowed actions
- Per-action limit
- Cumulative budget
- Expiry
- Beneficiary
- Mandate version
- Liquidity and lockup enforcement

Example summary values may show `300 MockUSDC`, `LiquidVault`, `No lockup`, and `Budget enforced`. Never show an active state before confirmed authorization and complete funding.

### 7. Evidence timeline

Section heading:

> Every action leaves evidence.

Suggested stages:

1. `Mandate authorized`
2. `Action proposed`
3. `Policy checked`
4. `Broadcast`
5. `Confirmed`

Only real on-chain actions receive transaction hashes and explorer links. HOLD, ESCALATE, and pre-broadcast rejection states must never display fabricated receipts.

### 8. Safety disclosure

Label:

> TESTNET ONLY

Copy:

> Built for Base Sepolia with MockUSDC and mock vaults. No real funds or investment returns. Connecting a wallet does not authorize asset movement.

### 9. Final action

Headline:

> Ready to define your boundaries?

Action:

> Connect wallet

## Responsive behavior

### Desktop

- Use a 12-column content grid with a maximum width around 1280px.
- Hero copy occupies roughly five columns; the mascot composition occupies six to seven.
- Keep the headline readable in three lines or fewer.
- Trust principles remain in a four-column row.
- Alternate text-led and product-led sections to create rhythm.

### Mobile

- Stack hero copy, mascot, trust cards, and actions in that order.
- Keep the primary action full width and the secondary action text-based.
- Present trust principles in a two-column grid when space allows, otherwise one column.
- Convert workflow steps into a vertical timeline.
- Keep testnet disclosure visible before the user reaches an authorization action.
- Minimum control height: 44px. Avoid text smaller than 12px.

## Mascot usage

- Hero: confident guiding pose.
- Clarification: thinking pose.
- Confirmed evidence: success pose.
- Risk or dependency issue: warning pose with amber accent.
- No-action-needed decision: hold pose.
- Owner intervention required: escalation pose.
- Do not use the mascot to imply that an unconfirmed transaction succeeded.
- Do not place the mascot in every section; two or three appearances on a full desktop page are enough.
- Preserve the approved identity and segmented boundary ring from `../mascot-boundary-spirit/README.md`.

## Color tokens

| Role | Hex |
| --- | --- |
| Forest | `#122D27` |
| Green | `#23674E` |
| Ivory | `#F6F8F2` |
| Sage | `#9BAF8D` |
| Lime | `#A6C74C` |
| Amber | `#D8A13B` |
| Charcoal | `#19332D` |

## Generation briefs

The references were created with the built-in image-generation tool using the approved mascot model sheet and transparent hero artwork as identity references.

- **Desktop hero:** editorial two-column landing viewport with hero copy, mascot-guided intent/boundary/evidence cards, and four trust principles.
- **Full page:** complete narrative from intent through workflow, eligibility, mandate preview, evidence, disclosure, and final action.
- **Mobile:** vertically stacked hero, mascot, trust cards, actions, workflow, and persistent testnet disclosure.
- **Section board:** navigation, buttons, badges, trust cards, workflow cards, eligibility comparison, mandate preview, timeline, safety banner, and mascot states.

