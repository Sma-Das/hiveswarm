# Console design

## Direction

A light, evidence-first working interface for expert security operators on laptops. Vercel, Wiz, Apple, and recent Cloudflare sites set the requested standard for restraint and technical clarity. This is a conventional enterprise interface executed consistently, not a theatrical security command center.

The physical use scene is a long assessment session on a laptop in an ordinarily lit workspace. White content and a near-white sidebar provide readable boundaries without forcing every region into a dark pane.

## Navigation and hierarchy

- A 64px top bar owns the product identity, current project, live-update indicator, and approval count.
- A 224px navigation column shares its right alignment line with the top-bar identity region. It is independent of the graph, so evidence resizing cannot displace navigation.
- The content area uses 32px horizontal padding on larger screens and 16px on phones, with a 1440px maximum content width.
- A project-level assessment bar holds the actual lifecycle state and run controls across all views.
- Overview shows actionable counts, asset relationships, decisions waiting for review, and priority findings.
- Assets and Specialists default to lists with graph alternatives. Inspection uses side sheets, not an always-open third pane.
- Dedicated Approvals, Scope, Report, and registry views separate authority, evidence, and package management.
- View identity is stored in the `view` query parameter. Project ownership is never derived from that convenience navigation state.

## Typography

Geist Sans is the working typeface. Geist Mono is reserved for commands, package identifiers, metadata, and technical evidence. Page headings are 24px semibold with tight tracking. Body text is 14px with generous line height; compact metadata uses 12px. Counts and confidence values use tabular numerals. Labels use sentence case rather than tracked uppercase.

## Color

Semantic tokens live in `app/styles.css` and are exposed through Tailwind v4.

| Role | Value | Use |
| --- | --- | --- |
| Background | `#ffffff` | Content and controls |
| Foreground | `#202329` | Working text |
| Sidebar | `#fafafb` | Persistent navigation |
| Muted | `#f4f5f6` | Low-emphasis backgrounds |
| Muted text | `#606670` | Secondary labels and descriptions |
| Border | `#e5e7eb` | Section and table boundaries |
| Primary | `#24272b` | Primary actions |
| Brand | `#e96528` | HiveSwarm mark only |
| Selection | `#eaf1ff` / `#2459aa` | Active navigation |
| Focus | `#2864cc` | Keyboard focus |
| Success | `#22734b` | Completed/connected states |
| Warning text | `#8b510c` | Pending decisions and authority notices |
| Danger text | `#b52f35` | High-priority findings and destructive actions |

Meaning must also be available as text. Severity includes a labeled five-mark indicator. A colored dot alone never carries lifecycle meaning.

## Components

Shared shadcn-style components live in `components/ui`, using local Tailwind classes and Radix behavior where needed. `lib/utils.ts` owns class merging. Primitives contain no API calls, project state, or authorization decisions.

Buttons, inputs, and selects use a common height and focus treatment. `NativeSelect.wrapperClassName` sizes the wrapper together with its chevron in compact toolbars. Tables use shared headers and cells; their overflow region is keyboard-focusable. Lists and tables own one border, never nested outlines.

Dialogs protect focused tasks such as project creation and manifest installation. Sheets hold evidence or execution details. Both trap focus, support Escape, and return focus to the originating control, including programmatic openings without a Radix Trigger. Sheet movement is a short 180ms horizontal transition; reduced-motion preferences disable it.

## Graph integration

`app/ui/security-graph.css` is the bounded exception to utility-based styling. React Flow owns layout and viewport behavior. Nodes use white surfaces, compact semantic icons, and a blue selection boundary. Relationships remain labeled. Saved node positions remain project- and graph-specific. Resizing a normal canvas does not reset the operator's viewport; explicit reset/fit controls remain available. Enter opens the focused node's inspection. The minimap is hidden on phones; list views retain access to the same underlying evidence.

## Responsive behavior

Below 768px, navigation opens in a left sheet and the content occupies the viewport width. Run actions wrap instead of disappearing. Pending decisions precede the overview graph below the wide two-column breakpoint. Evidence sheets use the available phone width. Wide tables scroll inside their region rather than widening the document. No essential mutation depends on a desktop-only panel.

## Truth and states

Display stored lifecycle states literally. A reconnecting event stream or failed refresh leaves evidence visible with a warning. Empty findings do not prove absence of vulnerabilities. Missing evidence paths are labeled as fallbacks derived from the finding record. Scope proposals explicitly disclose durable scope changes and possible removal of a matching exact deny; execution approvals remain one-time decisions. The sample-project label describes seeded data, not execution mode.

## Verification limits

The browser suite covers Chromium at 1440x1000 and 390x844, automated WCAG A/AA checks, workflow interactions, and selected geometric invariants. It does not establish manual screen-reader compatibility, Safari/Firefox parity, performance on very large evidence graphs, or expert-operator usability outcomes. A separate reviewer was unavailable due to the agent usage limit; the finish review was performed in-thread.
