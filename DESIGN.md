---
name: Escalar AI POS - Operational Design System
description: The implemented authenticated POS visual system, scoped to body.pos-operational.
colors:
  primary: "#25824f"
  accent: "#35a167"
  primary-hover: "#1e6c41"
  ink: "#262626"
  muted: "#666"
  paper: "#fff"
  canvas: "#f5f5f5"
  line: "#e5e5e5"
  soft-green: "#daf1e3"
  footer: "#fafafa"
  placeholder: "#707070"
  nav-ink: "#303936"
  nav-hover-ink: "#176d4b"
  settings-selected: "#eaf6ef"
  chip-neutral: "#eee"
  chip-muted: "#606460"
  warning-bg: "#fff2b4"
  warning-ink: "#82570d"
  rejected-bg: "#ffe3e4"
  rejected-ink: "#a22529"
  danger: "#bd4a43"
typography:
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  editor-title:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 550
    lineHeight: 1.45
    letterSpacing: "0"
  card-title:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 550
    lineHeight: 1.45
    letterSpacing: "0"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 450
    lineHeight: 1.45
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.45
  action:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 550
    lineHeight: 1.45
  supporting:
    fontFamily: "Inter, sans-serif"
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.45
  payment-chip:
    fontFamily: "Inter, sans-serif"
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: 1.45
rounded:
  control: "7px"
  settings-navigation: "8px"
  image: "10px"
  surface: "12px"
  confirmation: "15px"
  modal: "19px"
  pill: "999px"
spacing:
  tight: "4px"
  field-gap: "6px"
  action-gap: "8px"
  compact: "12px"
  settings-mobile-content: "15px"
  standard: "16px"
  settings-content: "18px"
  workspace-gap: "20px"
  section: "24px"
  preview: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  navigation:
    backgroundColor: "transparent"
    textColor: "{colors.nav-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  navigation-active:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
  navigation-hover:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.nav-hover-ink}"
  section-tabs:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    padding: "0 12px"
  settings-navigation:
    backgroundColor: "transparent"
    textColor: "#323a36"
    typography: "{typography.label}"
    rounded: "{rounded.settings-navigation}"
    padding: "8px 10px"
  settings-navigation-active:
    backgroundColor: "{colors.settings-selected}"
    textColor: "{colors.primary}"
    typography: "{typography.action}"
  payment-chip:
    backgroundColor: "{colors.chip-neutral}"
    textColor: "{colors.chip-muted}"
    typography: "{typography.payment-chip}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  payment-chip-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-ink}"
  payment-chip-rejected:
    backgroundColor: "{colors.rejected-bg}"
    textColor: "{colors.rejected-ink}"
  settings-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
  settings-card-content:
    padding: "{spacing.settings-content}"
  settings-card-content-mobile:
    padding: "{spacing.settings-mobile-content}"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "{spacing.workspace-gap}"
---

# Design System: Escalar AI POS

## Overview

**Creative North Star: "The Working Counter"**

Escalar AI POS uses a quiet, compact working surface: a light gray canvas, white containers, fine dividers, and green cues that direct attention without recoloring the entire workspace. The Maspedidos reference informs the operational density and familiar controls; the visible identity remains Escalar AI POS.

This document describes the implemented authenticated interface inside body.pos-operational, including body-mounted dialog portals. It is not a redesign proposal or a visual contract for login and the public menu, which retain their separate incumbent presentation. Shared primitives are consistent, while tables, kitchen cards, and split editors retain their own useful structures.

This is a source-derived snapshot, not a claim of comprehensive visual parity or behavioral certification. The visual authority is the final cascade of `src/styles.css`, the workspace styles, and `src/operational-theme.css`; `src/main.tsx` loads the operational layer after the base stylesheet. The Shell adds and removes the body scope. Representative supplied captures corroborate the menu, editor, and mobile settings presentation. Product authority remains in the workspace AGENTS.md; no business policies are restated here.

**Key Characteristics:**
- Self-hosted Inter, readable body copy, and compact section headings.
- White bordered surfaces on a neutral gray workspace.
- Distinct green roles for primary actions and selection.
- Compact desktop controls with enlarged mobile and coarse-pointer targets.
- Persistent context, understated outline icons, and contextual editors.

## Colors

A neutral working palette carries the content; greens identify actions and selection, while local status tones retain their operational meaning. The frontmatter is the normative extracted token list. There is no separate secondary or tertiary brand palette.

### Primary

- **Primary Green** (`primary`): filled primary controls, caret color, and the shared keyboard outline. The two inherited dark-green aliases resolve to this same operational value.
- **Selection Green** (`accent`): section underlines, chart strokes, availability selections, and active availability switches.
- **Deep Action Green** (`primary-hover`): primary-button hover without movement.
- **Soft Green** (`soft-green`): selected text background and inherited positive-status surfaces.
- **Settings Selection Wash** (`settings-selected`): the local filled active state of settings navigation, distinct from the transparent active Shell link.

### Neutral

- **Working Canvas** (`canvas`) and **Paper White** (`paper`): the workspace and its content surfaces.
- **Fine Line** (`line`): the shared control and container boundary.
- **Ink**, **Muted**, and **Placeholder**: principal reading, supporting information, and empty-field hints.
- **Footer White** (`footer`): pagination and settings action strips.
- **Navigation Ink** and **Navigation Hover Ink**: the inherited Shell-link colors that remain under the operational layer.
- **Chip Neutral** and **Chip Muted**: the default payment-badge pair.

### Status Accents

Warm warning, pale red rejection, and the inherited destructive red remain separate from brand selection. Pending payment and payment-review badges share the warning pair; a written label distinguishes them. The common `StatusPill`, settings chips, promotion chips, service-channel tags, and kitchen timers still have their own local palettes and sizing. Do not misrepresent them as one already-unified badge API.

**The Two Greens Rule.** Use Primary Green for filled white-text actions and keyboard outlines; use Selection Green for tab indicators and the implemented selection accents. They are distinct tokens, not interchangeable aliases.

## Typography

**Body and interface font:** Inter with a sans-serif fallback. The variable face is self-hosted from `/fonts/inter-latin.woff2`, with a declared weight range of 400-700 and swap loading. The operational system does not introduce a separate display or serif role.

The character is compact and matter-of-fact, with hierarchy carried by weight, grouping, and white space instead of oversized headlines. Body text is the established reading baseline (16px); the aligned workspace headings use the headline role (20px at the normal root size). Form labels remain full-sized rather than becoming microcopy.

### Hierarchy

- **Headline:** aligned workspace titles, medium weight, and a compact line height.
- **Editor title:** drawer and editor headings, slightly stronger than page titles.
- **Card title:** settings-card and section titles at the body size.
- **Body and label:** ordinary content and field labels; variable weight 450 is intentional.
- **Action:** shared buttons, Shell navigation, and section tabs; weight 550 is intentional.
- **Supporting:** field hints and secondary copy. Other local supporting styles retain weight 450 or 500.
- **Payment chip:** compact state labels with a stronger weight than supporting copy.

This is not a mathematical display scale. Smaller local metadata remains (13px chart labels and settings chips; 12px restaurant sublabels), and product preview names retain an intermediate size (18px). Shared generic modal and confirmation titles also retain their existing smaller size (1.1rem). The aligned headline role is not a claim that every inherited heading has already been normalized. Order totals and kitchen timers use tabular numbers where their component styles declare them.

**The Reading Scale Rule.** Keep the operational body and form labels at the body scale. Use the headline scale for the aligned workspace titles; preserve smaller metadata as a secondary layer rather than shrinking the entire interface.

## Layout

The desktop Shell places a white, sticky sidebar (240px) beside a flexible workspace. Its top bar is shallow (48px), with the restaurant context on the left and a compact operational indicator on the right. Main content uses inset padding (22px 24px 48px) and a regular vertical workspace gap (20px).

Lists are centered rather than stretched indefinitely: order lists, menu boards, cash panels, and availability containers use a shared upper width (1180px). Kitchen work uses an auto-fill grid of cards, with tracks ranging from a constrained minimum (300px) to a preferred maximum (360px), and card padding (16px). When the kitchen container reaches its compact threshold (640px), it becomes a single column with tighter grid spacing (12px).

Editors preserve a white working form and a neutral preview area. The large product, customization, promotion, new-order, and cash-cut drawers are capped at the implemented width (1200px). Product editing uses a two-part grid on desktop, with a slightly wider form side; section padding is generous relative to the lists (24px), preview padding is larger (32px), and actions remain in a bottom strip with a minimum height (70px).

Settings is a separate viewport layer. On desktop it starts below the top edge (40px), has a compact header (64px), and centers its navigation/content grid within a capped layout (1020px). Its navigation column is narrow (240px), the column gap is regular (24px), and the content area scrolls independently. Settings-card content has its own observed inset (18px), not the generic panel inset.

### Responsive Behavior

- **At or below 900px:** the Shell becomes a single workspace with an off-canvas sidebar, capped at the smaller of 280px and the viewport minus 48px. The top bar becomes taller (56px), and workspace padding becomes 20px 16px 40px. The hidden sidebar is inert; its open state acts as a dialog.
- **At or below 900px:** product, customization, and promotion editors become single-column, with preview available through a toggle. Settings fills the viewport and replaces its navigation list with a labeled section selector. Order lists become mobile rows; cash tables become labeled grid rows.
- **At or below 680px:** the secondary top-bar indicator is hidden and menu actions expand across the available width. Some catalog layouts retain this earlier component breakpoint.
- **At or below 640px:** settings forms collapse to one column and card-content padding becomes 15px. This viewport threshold is separate from the kitchen's container query at the same numeric width.
- **At or below 600px:** order tabs use a three-column, wrapping arrangement with smaller tab labels. Promotion and settings row layouts are adapted for narrow screens rather than hiding their key values.
- **At or below 560px:** the order toolbar wraps its search and actions using its existing component rule.
- **For coarse pointers or widths at or below 900px:** shared buttons, icon controls, field inputs, and selects receive the enlarged control treatment (at least 44px where the rule applies). Compact switch tracks sit inside larger touch buttons. This does not assert that every inherited clickable element has the same minimum height.

The spacing vocabulary in the frontmatter is an extraction of recurring values, not a replacement spacing framework. Keep distinct card, form, and toolbar insets where the implementation uses them.

## Elevation & Depth

The operational interface is shallow rather than entirely shadowless. White fill, pale gray surroundings, and thin borders do most of the separation. Standard containers and buttons retain very small shadows; popovers lift more clearly. The aligned top bar and large editor backdrops remove their former blur, and the large product/editor drawers remove their former shadow. Generic modals and settings overlays still carry their component-specific depth.

### Shadow Vocabulary

- **Surface:** `0 1px 2px #0000000d`, the shared operational container shadow.
- **Control:** `0 1px 2px #00000012`, the shared button shadow.
- **Popover:** `0 3px 8px #00000029`, used by action menus and the date popover.
- **Field focus halo:** `0 0 0 3px rgba(75,130,107,.12)`, inherited alongside the operational keyboard outline.
- **Generic modal:** `0 35px 90px rgba(9,16,13,.3)`, retained on the shared modal card.
- **Settings drawer:** `-18px 0 55px rgba(20, 32, 26, .2)`, retained on the narrow settings editor.
- **Settings confirmation:** `0 25px 75px rgba(12, 23, 17, .27)`, retained on the blocking confirmation surface.

Motion is primarily state feedback: shared button colors transition over 120ms with ease-out. The main page stack has no entrance animation, but settings sections and some drawers retain brief inherited page/drawer animations. Reduced-motion rules disable the affected transitions and entrances where declared; they are not a claim of a universal animation reset. Generic modal blur also remains an exception, not the operational top-bar treatment.

**The Surface Before Shadow Rule.** Use white fill and a fine boundary to establish ordinary containers. Keep stronger shadows local to overlays and floating controls rather than applying them to every card.

## Shapes

Controls and floating menus use softly squared corners through the control radius. Large cards and the aligned settings layer use the surface radius. Settings navigation retains its slightly rounder control variant; product images retain the intermediate image radius. Status chips remain full pills, while checkboxes, radio buttons, and small circular indicators retain their native or component-specific geometry.

Borders are generally thin (1px), with no decorative ornamental frames. Active section tabs use a short solid underline (3px), not a filled navigation capsule. Generic modal corners and settings-confirmation corners retain their distinct existing radii. The operational overrides are not evidence that every nested header or footer corner has been rewritten.

Icons are lightweight outline SVGs, usually in the observed range of 16-20px. They support written labels; compact icon-only actions carry accessible names. Product photography appears in catalog thumbnails or previews, not as a decorative workspace backdrop.

## Components

### Buttons

Compact, legible controls carry the action without dominating the workspace. The shared base has a minimum desktop height (36px), the control radius, modest padding, an icon gap (8px), and a small shadow. The actual height can exceed the minimum as text and padding require.

Primary buttons use the primary pair and deepen on hover, without a translate or scale effect. Secondary and ghost buttons both resolve to white, bordered neutral controls in this operational scope. The inherited secondary hover border is overridden by the scoped neutral border; ghost and danger do not acquire a new hover color here. Danger uses the retained destructive token with white text. The sidecar represents these four common variants separately rather than inventing extra emphasis levels.

Keyboard focus uses the operational outline (2px, offset 3px). Disabled shared buttons and icon buttons fade (opacity 0.48) and use a not-allowed cursor. No additional pressed transform is defined for these common variants. Icon buttons use a compact square (36px), enlarged by the shared touch rule; contextual icon-only menu buttons retain their local hover styling.

### Inputs / Fields

White fields use the shared line color, control corners, and comfortable inner padding. Full-size labels sit above them with a small gap. Placeholder text is muted but not further faded; carets and native choice-control accents use Primary Green.

Focused fields retain the inherited soft halo. The higher-specificity operational border keeps the normal line color; keyboard focus adds the distinct shared outline. No universal error border or disabled field opacity is established by the operational layer. Error feedback is rendered separately, and busy settings groups use their existing disabled or inert behavior. Search fields preserve explicit left space for their icons.

### Navigation

The Shell uses outline icons and sentence-case labels on a white sidebar. Each item has a compact minimum height (40px), the control radius, and no filled active capsule. The active item is green on transparent; hover adds the canvas wash. The Escalar AI POS identity remains above the restaurant and branch context.

Settings navigation is a distinct list inside a white bordered container: ordinary labels are lighter in weight, while the active entry uses the settings selection wash and stronger green text. It becomes a section selector on smaller screens, not a horizontal list squeezed into the same area.

Section tabs use the body-sized action style, a neutral inactive underline, and Selection Green for the active underline. They scroll or wrap according to the owning workspace. The sidecar's navigation snippets reproduce appearance only; routing, modal navigation, and active-state changes belong to the app.

### Chips

Payment badges are full pills with a small circular marker and explicit status text. Warning and review states use the warm warning pair; rejected uses the rejection pair. Pending uses an outlined marker, while review uses a filled marker. These are noninteractive labels, not buttons, so no hover or pressed behavior is invented.

Other status families remain intentionally documented as local variants rather than forced into this exact payment-badge anatomy. Promotion status, settings status, channel tags, and kitchen timers differ in padding, type size, and color. Reuse the component that owns the meaning.

### Cards / Containers

Ordinary panels and aligned cards are white, fine-bordered, and shallow. Generic panels use their own content inset; settings cards separate a compact title header from padded content and can append a lightly tinted action strip. At the settings mobile breakpoint, only the content and footer insets tighten; the title remains readable.

Kitchen cards are denser task records with no shadow, grouped text, status/timing cues, and a contextual bottom action. They are not large dashboard metric tiles. Tables use neutral headings, fine row boundaries, and compact action menus; the exact row height and mobile transformation remain component-specific.

### Dialogs and Editors

Large editors preserve separate header, scrolling body, and footer regions. The preview is a secondary neutral pane on desktop and a user-opened view on compact layouts. Narrow settings drawers and centered confirmations retain their distinct sizes and overlay depth.

Shared dialogs mount under the body so the operational scope reaches their controls. The shared dialog helper contains keyboard focus, handles Escape for the topmost surface, locks body scrolling, and restores focus to an eligible opener or parent surface. These are source-observed behaviors, not independently executed tests in this documentation pass. The sidecar previews do not simulate the application's dialog state machine.

## Do's and Don'ts

### Do:
- **Do** keep this system scoped to the authenticated operational body, including its dialog portals.
- **Do** retain the Escalar AI POS name and existing identity assets.
- **Do** use Primary Green for primary buttons and Selection Green for the established selection cues.
- **Do** preserve the readable body scale, compact headings, and enlarged mobile/coarse-pointer controls.
- **Do** retain visible focus, written status labels, and the existing dialog focus behavior.
- **Do** reuse the appropriate list, kitchen-card, or editor structure instead of forcing every module into an identical layout.

### Don't:
- **Don't** restyle login or the public menu with the operational tokens.
- **Don't** import Maspedidos branding, marketing copy, or unsupported controls.
- **Don't** replace the neutral operational canvas with decorative gradients or a dark sidebar.
- **Don't** add large entrance effects or uniform raised-card styling to the aligned workspace.
- **Don't** treat component-specific legacy values as a new global palette or silently normalize them while following this document.
- **Don't** treat the synthesized tonal ramps in the sidecar as implemented application tokens.
