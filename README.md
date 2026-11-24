# InstaHarvest

**Local-first Instagram profile data, in your browser.**

InstaHarvest is a Manifest V3 Chrome extension that collects a public profile's details, posts, reels, followers, following, comments and likers **by reading the rendered page** in your own logged-in session — no official API, no internal endpoints, no backend, no telemetry.

> ⚠️ **Use a secondary account.** Automating actions on Instagram violates its Terms of Service and can get accounts action-blocked or disabled. This tool is deliberately slow, capped and walk-away-from-able, but it cannot make that risk zero. Test on a secondary account you can afford to lose.

---

## What it does

| Resource | How it is collected |
|---|---|
| Profile details | Header DOM + `og:` meta tags (username, name, bio, avatar, counts, verified, link, category) |
| Posts grid | Paced scroll until the grid stops growing, deduped by shortcode |
| Reels | Same grid harvester on the Reels tab |
| Post detail | Opens the post view (modal, full page as fallback), reads caption, counts, timestamp |
| Carousel | Clicks Next slide-by-slide (paced), captures every image/video |
| Comments | Expands “View N replies” and “Load more comments” (bounded), rebuilds the nested tree |
| Followers / Following | **Confirm flow**: you open the list, press Confirm, extension harvests the virtualized list |
| Likers | **Confirm flow per post**: you open the post and “N others”, press Confirm, extension harvests |

Everything is persisted to **IndexedDB** as it goes, so closing the tab or losing the service worker does not lose the run — reopen the panel and resume.

## What it deliberately does **not** do

- ❌ No `fetch()`/XHR to Instagram, no `/api/` or `/graphql/` calls. DOM only.
- ❌ No official API, OAuth or developer app.
- ❌ No follow-status enrichment per liker (no per-liker navigation).
- ❌ No auto-opening likers modals.
- ❌ No parallel harvest loops, no speed-maximizing scroll loops.
- ❌ No remote backend, proxy, analytics or logging.
- ❌ No obfuscated class selectors.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Open (or reload) `https://www.instagram.com` in a tab and sign in.
5. Click the InstaHarvest icon — the side panel opens.

Chrome 116+ is required (side panel API). If the panel opens blank after a Chrome update, reload the extension.

## Use

1. Paste a username or profile URL, pick a preset:
   - **Quick** — header + first 12 posts (good first run).
   - **Deep** — posts, reels, followers, following, comments, likers.
   - **Custom** — any combination + your own caps.
2. Press **Start**. The extension navigates the tab to the profile and works through a persisted step queue.
3. When a card says **waiting for you**, do what it asks on the Instagram tab (open the followers list, or the post's likers list), then press **Confirm**. “Open it for me” will click the right link for you where possible — it still waits for your Confirm before harvesting.
4. **Pause / Resume / Stop** any time. **Skip** a Confirm step without aborting the run.
5. Export **JSON** (full fidelity) or **CSV** (one file per resource) from the Export card.

### Caps and pacing (why it is slow)

There is no such thing as an unlimited rate. Every automated scroll and click is followed by a randomized **700–1200 ms** pause (adjustable 700–2000 ms). Only one harvest loop ever runs. Caps are enforced by the service worker, not the content script:

- `maxFollowers`, `maxFollowing`, `maxLikersPerPost`, `maxCommentsPerPost`, `maxPosts`
- `maxProfilesPerDay`, `maxMinutesPerDay` (hard stop with a clear message)
- Session break reminder at a configurable elapsed time

Do not lower the pacing below 700 ms. Instagram rotation and action blocks are real; this tool paces and caps, it does not evade.

### Data & privacy

Scraping other people's followers/likers produces **personal data**. You are responsible for using it lawfully (GDPR / CCPA / DPDP and any local rules). Everything stays in this browser profile's IndexedDB; nothing is uploaded. There is **no telemetry**. Uninstalling the extension or clearing extension storage deletes the data.

## File map

```
manifest.json
icons/                     extension icons
src/
  background.js            service worker: job queue, caps, routing, persistence
  content.js               classic bootstrap that imports content-main.js
  content-main.js          only DOM-touching component; loads harvesters lazily
  selectors.js             ALL selectors, fallbacks, lastVerified, broken reporting
  messages.js              message type constants
  pacing.js                sleep/jitter/cap helpers
  dom-utils.js             DOM math/media/text helpers (selector strings live in selectors.js)
  harvesters/
    profile.js             header + og: meta
    grid.js                posts/reels grid scroll + dedupe
    list.js                shared virtualized-list harvester + list opener
    post.js                post open/close, detail, carousel
    comments.js            thread expansion + tree builder
    likers.js              Confirm-flow wrapper for likers
    session.js             signed-in / logged-out detection
  panel/
    panel.html / panel.css / panel.js
  storage/
    db.js                  promise IndexedDB wrapper
    schema.js              defaults, presets, config builder
    export.js              JSON + CSV builders, download helpers
```

**Why the split:** content script owns all DOM access; the worker owns state, caps and routing; the panel owns UX and exports. No component crosses those boundaries.

## Selector maintenance

Instagram rotates CSS classes, so this project never depends on them. All selectors live in `src/selectors.js` as `{ name, description, query, fallbacks, lastVerified }` using ARIA roles, `aria-*`, `href` patterns, visible text and structure.

When something breaks:

1. Reproduce on a live tab.
2. The panel shows a warning with the **selector name** (e.g. `gridLink`) and the log contains `SELECTOR_BROKEN`. Use **Copy debug info**.
3. Inspect the DOM in DevTools, find a stable ARIA/text/structure hook.
4. Update the entry in `selectors.js` (add a fallback rather than replacing the primary), bump `lastVerified`.
5. Reload the extension and re-run a Quick harvest.

## Test plan

- Secondary account, small test profile (< 20 posts).
- Quick preset: profile, 12 posts, carousel, no confirm steps.
- Deep preset with a small `maxFollowers`/`maxFollowing` (e.g. 50) to verify the Confirm flow.
- Close the tab mid-harvest → reopen → the job should be paused; Resume.
- Close the panel mid-harvest → reopen → progress and Confirm card restore.
- Hit a cap: set `maxMinutesPerDay` to 1 → verify hard stop message.
- Rehearse a selector break: temporarily change `gridLink` in DevTools → verify warning + no crash.
- Export JSON and CSV; verify counts, carousel arrays, comment `parent_id` chains, likers per post.

## Troubleshooting

- **“Could not reach the Instagram tab”** — reload instagram.com once after installing/reloading the extension, then try again.
- **“Signed out”** — log in on instagram.com; the extension cannot read cookies and infers the session from the page.
- **Confirm says the dialog is not open** — leave the list modal open on top of the page; nested modals or a filter tab can confuse detection. Close other dialogs and press Confirm again.
- **Missing post images** — carousel slides are captured from the largest visible image; region-locked or deleted posts are skipped with a logged error.
- **Instagram UI changed** — update `selectors.js` per the workflow above.

## Notes on responsibility

This tool is provided for personal, lawful use with data you have the right to access. Respect Instagram's terms, people's privacy, and local law. The author accepts no responsibility for account restrictions or misuse.
