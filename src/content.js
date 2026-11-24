/**
 * InstaHarvest — content bootstrap.
 *
 * Manifest content scripts are classic scripts, so this tiny file only loads
 * the real ESM entry point (`content-main.js`, declared as a
 * web_accessible_resource) inside the same isolated world.
 */
(() => {
  const entry = chrome.runtime.getURL('src/content-main.js');
  import(entry).catch((err) => {
    console.error('[InstaHarvest] Failed to load the content entry point:', err);
  });
})();
