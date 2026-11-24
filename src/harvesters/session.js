/**
 * InstaHarvest — session detection (DOM only).
 * We cannot read cookies; we infer a signed-in session from the rendered page.
 */
import * as S from '../selectors.js';

export function checkSession() {
  const host = location.hostname;
  const onInstagram = /(^|\.)instagram\.com$/i.test(host);
  const loginLink = S.select('loginLink');
  const nav = S.select('sessionNav');
  const bodyText = (document.body?.innerText || '').slice(0, 4000);
  const looksLikeLoginWall = /log in to instagram|sign up to see/i.test(bodyText);
  const loggedIn = Boolean(onInstagram && nav && !loginLink && !looksLikeLoginWall);

  const path = location.pathname || '/';
  let profileUsername = '';
  const match = path.match(/^\/([A-Za-z0-9._]{1,40})\/?$/);
  if (match) profileUsername = match[1];

  return {
    loggedIn,
    onInstagram,
    loggedOutMarker: Boolean(loginLink) || looksLikeLoginWall,
    url: location.href,
    path,
    profileUsername,
    dialogOpen: Boolean(S.select('dialog')),
    scrollY: Math.round(window.scrollY || 0)
  };
}
