# Round navigation and directory

Purpose: find and follow concurrent funding rounds without carrying one round's
data or actions into another. Uses the existing Blossom tokens and typography.

- Site header: wordmark, All rounds, Create round. No selected-round query on
  global links. The directory is the home page even with a configured default.
- Round navigation: breadcrumb back to All rounds, visible round name and address,
  switcher, then Overview / Proposals / Vote / Liquidity. Submit an idea and Manage
  round are a separate action group; management exposes Setup and Import proposals.
- Directory: search by name/address, All / Active / Completed filters, independent
  loading/error/retry per round, live status and funding totals. Open a round by
  address with an optional browser-local label; validate with the API before saving.
- Sources: configured VITE_ROUNDS and legacy VITE_POOL_ADDRESS, plus browser-local
  visited rounds, scoped to the configured chain. This is not a chain-wide registry.
- State: the URL selects the round on every navigation, including back/forward.
  Switching returns to the new round's overview. Cached placeholders and transient
  page state never cross round boundaries. Existing ?pool= links remain usable.
- Accessibility: named navigation landmarks, aria-current links, labeled native
  select/search controls, text status, visible focus, 44px targets, no hover menus.
- Responsive: context and action groups wrap; round lists become single-column;
  addresses wrap instead of widening the page. No essential navigation is hidden.
- Composition: native atoms and existing Button/Field/Badge/Money molecules compose
  presentational navigation and directory entries. Providers and route containers
  own URL state, local persistence and API queries.
- Tokens: semantic color, spacing, type, rule, control-height and width tokens from
  web/app/tokens.css. No new palette or reference tokens.

Acceptance: two simultaneously open rounds remain individually discoverable;
switch A → B → browser Back restores A; direct links identify their round; loading B
never displays A's balances, ballot, or project; global pages have no stage bar;
empty, unavailable, and filtered lists offer a clear next action.
