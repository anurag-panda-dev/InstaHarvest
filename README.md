# InstaHarvest

<p align="center">
  <img src="InstaHarvest.png" alt="InstaHarvest Chrome extension" width="680">
</p>

<p align="center">
  <strong>Local-first Instagram profile data for your browser.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#export-options">Exports</a> •
  <a href="#privacy-and-responsibility">Privacy</a> •
  <a href="#troubleshooting">Troubleshooting</a>
</p>

<p align="center">
  <a href="https://github.com/anurag-panda-dev/InstaHarvest">GitHub repository</a> •
  <a href="https://github.com/anurag-panda-dev/InstaHarvest/releases">Releases</a> •
  <a href="https://github.com/anurag-panda-dev/InstaHarvest/archive/refs/tags/v1.0.0.zip">Direct release ZIP</a>
</p>

<p align="center">
  <img src="icons/Icon-128.png" alt="InstaHarvest icon" width="96">
</p>

---

InstaHarvest is a Manifest V3 Chrome extension that organizes public Instagram profile data by reading the rendered page in your own logged-in browser session.

It does **not** use Instagram OAuth, an official Instagram API, internal GraphQL endpoints, a backend, or cloud storage. Harvested data is saved locally in IndexedDB and can be exported as JSON, CSV, or a ZIP containing post images.

> [!CAUTION]
> Instagram automation may violate Instagram's Terms of Service and could result in temporary action blocks, account restrictions, or account loss. Use a secondary account, keep the built-in pacing enabled, and never treat this extension as a way to evade platform limits.

## Features

### Profile data

- Username and full name
- Bio, profile picture, category, and verified status
- Follower, following, and post counts
- External profile link

### Post discovery

- Posts and reels grid harvesting
- Virtualized feed scrolling
- Shortcode deduplication
- Configurable post limits
- Post timestamps and thumbnails

### Post details

- Captions
- Like and comment counts
- Post timestamps
- Carousel slide discovery
- Post media URLs when available

### Community data

- Followers
- Following
- Per-post likers
- Comment threads and replies
- Avatars and profile links

### Harvest controls

- Quick, Deep, and Custom presets
- Human-like randomized pacing
- Pause, resume, retry, and stop controls
- Per-resource progress
- Daily profile and session limits
- User-confirmed follower, following, and liker dialogs
- Automatic job state persistence

### Modern side-panel UI

- Professional branded splash screen
- Light, dark, and automatic themes
- Clear live status and progress
- Expandable activity log
- Export status and diagnostics
- Responsive Chrome side-panel layout

## Export options

| Format | Contents |
| --- | --- |
| **JSON** | Complete structured profile, post, follower, following, comment, liker, and export metadata |
| **CSV** | Flattened followers, following, posts, comments, and likers files |
| **Post Images ZIP** | Downloaded image posts and carousel images named with the profile username and post date/time |

Post image filenames use this format:

```text
username-YYYY-MM-DD-HHMMSS.png
username-YYYY-MM-DD-HHMMSS_2.png
```

The `_2`, `_3`, and later suffixes identify carousel slides. Reels and videos are excluded from the image ZIP. If Instagram blocks or removes a media URL, that individual image is skipped while other exports continue.

## Installation

### Download a release

- **[Download the InstaHarvest v1.0.0 ZIP](https://github.com/anurag-panda-dev/InstaHarvest/archive/refs/tags/v1.0.0.zip)**
- [View all GitHub releases](https://github.com/anurag-panda-dev/InstaHarvest/releases)
- [View the source repository](https://github.com/anurag-panda-dev/InstaHarvest)

### Requirements

- Google Chrome or a Chromium-based browser with side-panel support
- Chrome 116 or newer
- A signed-in Instagram tab

### Load as an unpacked extension

1. Download the latest `InstaHarvest.zip` release.
2. Right-click the downloaded ZIP and select **Extract All**.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extracted folder—the folder containing `manifest.json`.
7. Open Instagram and sign in.
8. Pin and open **InstaHarvest** from the Chrome toolbar.

After updating the extension files, use **Reload** on `chrome://extensions` and refresh the Instagram tab.

## Quick start

1. Enter an Instagram username or profile URL.
2. Choose a preset:
   - **Quick** — profile details and the first 12 posts
   - **Deep** — posts, reels, followers, following, comments, and likers
   - **Custom** — selected resources and individual limits
3. Select **Start**.
4. Leave the Instagram tab open while the harvest runs.
5. For follower, following, or liker harvesting, open the requested Instagram view and select **Confirm**.
6. Pause or stop at any time. Resume is available for unfinished jobs.

The extension navigates through one resource at a time. It stores progress in IndexedDB after each completed unit.

## Pacing and limits

Every scroll and click is followed by a randomized pause. The default range is 700–1200 ms, and it can be adjusted from 700–2000 ms in Settings.

Available limits include:

| Limit | Purpose |
| --- | --- |
| Max posts | Maximum posts or reels collected |
| Max followers | Maximum follower accounts collected |
| Max following | Maximum followed accounts collected |
| Max likers per post | Maximum likers collected for one post |
| Max comments per post | Maximum comments collected for one post |
| Profiles per day | Hard daily profile limit |
| Minutes per day | Hard daily session duration limit |
| Break reminder | Session elapsed-time reminder |

Lowering or disabling pacing does not make harvesting safer. The extension is intended to be deliberate and bounded rather than fast.

## How it works

```text
Side panel
    │
    │ chrome.runtime messages
    ▼
Service worker
    │
    │ chrome.tabs messages
    ▼
Instagram content script
    │
    ▼
Rendered DOM + IndexedDB
```

| Component | Responsibility |
| --- | --- |
| `src/panel/` | Side-panel UI, presets, controls, and exports |
| `src/background.js` | Job queue, routing, resume state, caps, and persistence |
| `src/content-main.js` | Main content-script task dispatcher |
| `src/harvesters/` | Profile, grid, post, list, comment, liker, and session harvesters |
| `src/selectors.js` | Stable selector definitions and fallbacks |
| `src/storage/db.js` | IndexedDB persistence |
| `src/storage/export.js` | JSON, CSV, and post image ZIP generation |

The content script is the only component that reads or changes the Instagram DOM. The worker owns orchestration and the panel presents worker state.

## Privacy and responsibility

- Data remains in this browser profile's IndexedDB.
- There is no cloud backend, analytics, telemetry, or remote log upload.
- Exported JSON and CSV files remain subject to local privacy and access-control rules.
- Follower, following, and liker data can contain personal information.
- Clearing extension data or uninstalling the extension removes local harvested data.
- Follow applicable privacy and data-protection laws, including GDPR, CCPA, DPDP, and local regulations.
- Collect only data you are authorized to collect and have a lawful purpose for using.
- Respect the privacy of people shown in exported data.

## Selector maintenance

Instagram UI changes frequently. This project avoids obfuscated CSS class names and keeps DOM selectors in [`src/selectors.js`](src/selectors.js).

Each selector includes:

- A human-readable name and description
- A primary stable query
- ARIA/text/structure-based fallbacks
- A last-verified date

When a selector stops matching:

1. Reproduce the issue on the Instagram tab.
2. Open Chrome DevTools.
3. Inspect nearby ARIA roles, accessible labels, href patterns, and structure.
4. Add or update fallbacks in `src/selectors.js`.
5. Update the `lastVerified` value.
6. Reload the extension and repeat the affected resource.

Broken selectors are reported to the panel, activity log, and debug information instead of silently continuing.

## Troubleshooting

### The Instagram tab could not be reached

Reload `instagram.com`, sign in, and restart the harvest.

### The follower or following dialog is not detected

Open the requested list, close unrelated dialogs, leave the list visible, and select **Confirm** again.

### The follower or following harvest skips accounts

Virtualized lists may need additional scrolling. Keep the list open and allow the stable-scroll loop to finish. Re-run with a smaller limit for testing.

### Post images are missing

Post media may be unavailable, region-locked, deleted, or blocked by Instagram. Re-run with **Posts** and **Carousel slides** enabled, then use the image ZIP exporter.

### A selector warning appears

Instagram may have changed its DOM. Update the named selector in `src/selectors.js` and reload the extension.

### The side panel is blank

Reload the extension at `chrome://extensions`, refresh Instagram, and reopen the side panel.

## Suggested test checklist

- [ ] Open a small secondary-account test profile.
- [ ] Harvest Quick: profile details and 12 posts.
- [ ] Verify timestamps and post counts.
- [ ] Verify JSON exports.
- [ ] Verify CSV exports.
- [ ] Verify carousel and image ZIP exports.
- [ ] Open follower and following dialogs and use Confirm.
- [ ] Pause and resume a running job.
- [ ] Close and reopen the panel without losing job progress.
- [ ] Trigger a daily or session limit.
- [ ] Rehearse a missing selector and verify the broken-selector warning.

## Repository layout

```text
insta-harvest/
├── manifest.json
├── README.md
├── InstaHarvest.png
├── icons/
└── src/
    ├── background.js
    ├── content.js
    ├── content-main.js
    ├── dom-utils.js
    ├── messages.js
    ├── pacing.js
    ├── selectors.js
    ├── harvesters/
    ├── panel/
    └── storage/
```

## Community and publication

Before publishing to a browser extension community or store:

- Test with public accounts and a secondary account.
- Replace or verify the marketing screenshot and store icons.
- Confirm that all permissions are necessary.
- Review the privacy policy and Chrome Web Store disclosure requirements.
- Document that Instagram content remains subject to Instagram's terms and that users are responsible for lawful use.
- Add a license if third-party redistribution is intended.

The project includes an MIT [license](LICENSE) and a standalone promotional and installation page in [`guide-page/`](guide-page/).
The page contains a detailed non-technical walkthrough with interface previews, mouse instructions, confirmation steps, controls, settings, and export guidance.

## Disclaimer

InstaHarvest is intended for personal, lawful, DOM-based data collection. It is not affiliated with or endorsed by Instagram or Meta.

Use of Instagram and scraped data is subject to applicable platform terms and local law. The project does not guarantee account safety, data completeness, or continued compatibility with Instagram UI changes.
