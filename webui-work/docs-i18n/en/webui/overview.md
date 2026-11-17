# Haizakura WebUI


Haizakura's browser console is a Vite + React application for managing runtime
status, OneBot configuration, logs, storage, and server settings.

## Default appearance

New installations and appearance resets use the mascot's lavender accent.
The light variant uses a deeper purple for readable button labels; dark mode
uses a softer lavender. Existing saved accents and custom colors are preserved.
The original sky-blue accent remains available in Settings.

With the default palette, page, card, input, popover and sidebar surfaces mix a
small amount of the active accent into neutral light/dark backgrounds. Text stays
neutral for readability. Sidebar-only accents tint only the sidebar; OLED keeps a
true-black canvas. Named palettes, custom CSS variables and host appearance
overlays retain control of their own surfaces.

Keep the server defaults in `packages/core/src/webui/ui-config.ts`, the frontend
defaults and preset in `src/contexts/ThemeContext.tsx`, and the pre-mount tokens
in `src/index.css` aligned when changing the default accent.

The browser favicon, home-screen icon and in-app logo share the mascot avatar
in [`assets/brand/mascot-avatar.png`](../../assets/brand/mascot-avatar.png).
Its exported sizes live in `public/`: `logo.png` (512 px), `favicon.png` (64 px),
and `apple-touch-icon.png` (180 px). Export from the master without redrawing
individual sizes.

## Host appearance integration

`SNOWLUMA_WEBUI_TARGET=maibot` opts a deployment into a reversible millennium
appearance overlay. Standalone defaults are unchanged. Hosts drive live light/dark
updates without saving over personal preferences or adding another selector.
See [the integration contract and extension guide](INTEGRATIONS.md) before changing
target startup, theme ownership, host messaging or scoped styles.

## Interaction conventions

- Destructive actions and second confirmations stay in modal dialogs.
- Operations that may take time show a bottom-right running state.
- Completed and failed operations use bottom-right result notices that close
  automatically after a visible countdown.
- Routine, high-frequency adjustments should not generate a notice for every
  intermediate edit.
- Foreground polling pauses in hidden tabs and waits for each request to finish
  before scheduling the next. Connection-state polling runs only while SSE clients
  are subscribed.
- Data-backed surfaces use the Interior Skeleton Swap defaults (120 ms delay,
  380 ms minimum visibility) so fast local responses do not flash a placeholder.
  Submission, upload, and other explicit operation progress keeps its spinner.
- Variable-height content must release the skeleton's reserved box after it is
  ready; do not introduce a second scrolling region inside the page.
- The mobile navigation menu uses a controlled Icon Morph whose visual state
  follows the actual drawer state.
- Failures must remain visible in the affected control and in the operation
  result; do not convert failed responses into successful feedback.
- JSON endpoints must return an object. Malformed or non-object responses are
  reported as errors rather than displayed as empty lists or default settings.
- Configuration responses include `config`; saves also report `saved`, `applied`,
  `online`, `errors`, and `message`. The UI uses these fields without legacy aliases
  or a second request after saving.
- Password change flows use floating labels and inline validation consistently.
- Password strength details appear only while the new-password field has focus
  and leave with the same motion language when focus moves away.
- The first-run wizard keeps agreement text as the primary reading surface and
  aligns each step's actions inside one responsive footer. Settings includes a
  visible developer page for safely replaying this wizard and exercising the
  page-level crash screen; replayed consent and passwords are never persisted.

## Authentication behind a reverse proxy

Authenticated WebUI requests send the session token in `X-SnowLuma-Token`, leaving
`Authorization` available for the reve