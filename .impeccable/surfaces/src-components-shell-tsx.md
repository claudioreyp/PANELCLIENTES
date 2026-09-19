---
version: 1
slug: "src-components-shell-tsx"
primary_target: "src/components/Shell.tsx"
related_targets: ["src/operational-theme.css","src/pages/Dashboard.tsx","src/pages/Catalog.tsx","src/pages/Orders.tsx","src/components/CashWorkspace.tsx","src/components/AvailabilityWorkspace.tsx","src/components/SettingsWorkspace.tsx"]
---

# Operational POS: Maspedidos Parity, Phase One

## Mode
Operate. Staff need fast scanning, predictable controls, safe edits, and honest confirmations during restaurant service.

## Visual Direction
Use the user's Maspedidos screenshots and read-only desktop audit as the pinned reference. Match the compact navigation, neutral gray canvas, white bordered surfaces, green underlines, dense tables, and split editors. Preserve Escalar AI identity and the existing type of information in each module rather than forcing every screen into one layout.

## Scope
Authenticated Shell, Inicio, Pedidos and kitchen commands, Menu, Caja, Disponibilidad, and supported Settings. Login and the public menu keep their existing presentation. Product authority remains ../AGENTS.md; no product policies are redefined here.

## Rules
Inter self-hosted, body 16px; headings 20px; desktop controls 36px with 7px corners; touch targets at least 44px. Canvas #f5f5f5, white surfaces, #e5e5e5 borders, #35a167 selection, #25824f white-text primary controls. Center lists near 1180px and kitchen cards near 360px. Use restrained depth, not decorative gradients or entrance animations.

## Protected Behaviors
Keep calculations, history, branch isolation, payment review, order confirmation, and working operational flows. A failed reload must not turn a confirmed write into a failure. Data loading errors must not look like zero sales. Hidden mobile navigation must be inert and dialogs must restore focus.

## THESIS
One consistent working POS: staff should locate the next operational action without learning a new visual language in every module.

## OWN-WORLD
The user explicitly pinned Maspedidos as the familiar visual reference. Preserve Escalar AI identity and domain safeguards, not Maspedidos marketing, subscription or unverified integrations.

## STORY
Navigation leads to a compact workspace, then to a table or kitchen cards, then to contextual actions and a protected editor. Secondary explanations stay available as accessible help instead of dominating the working area.

## FIRST VIEWPORT
Show the restaurant context, section title and primary controls before the working data. Dashboard begins with current availability and date controls; order lists and commands begin with their count and active work.

## FORM
Code-led reproduction of the user's fixed reference. A concept seed and alternative-direction tournament were intentionally not run because a user-pinned direction takes precedence. No retrospective seed or generated approved comp is claimed.

## QUALITY BAR
Match the supplied Maspedidos references in density, hierarchy, neutral surfaces, green selection and split editing. Improve accessible contrast and touch hit areas without introducing a different aesthetic. Ship only supported functions; screenshots verify presentation, isolated tests verify the exercised behaviors, and neither certifies untested external services.

## Verification
Mocked or isolated data only. Group desktop, tablet, and mobile evidence for the seven main surfaces; perform one joint correction and at most one confirmation round. Execute the Impeccable detector once at the end. Record verified, preserved, and deferred capabilities without claiming unsupported PIN/device or direct-QZ printing is complete.
