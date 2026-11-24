const modules = [
  '../src/messages.js',
  '../src/pacing.js',
  '../src/selectors.js',
  '../src/dom-utils.js',
  '../src/storage/schema.js',
  '../src/storage/db.js',
  '../src/storage/export.js',
  '../src/harvesters/session.js',
  '../src/harvesters/profile.js',
  '../src/harvesters/grid.js',
  '../src/harvesters/list.js',
  '../src/harvesters/comments.js',
  '../src/harvesters/post.js',
  '../src/harvesters/likers.js'
];

for (const path of modules) {
  try {
    const mod = await import(path);
    console.log('OK', path, Object.keys(mod).length, 'exports');
  } catch (err) {
    console.log('FAIL', path, err.message);
  }
}

const S = await import('../src/selectors.js');
console.log('selector count', Object.keys(S.SELECTORS).length);
console.log('all have fallbacks+verified', Object.values(S.SELECTORS).every((s) => s.lastVerified && Array.isArray(s.fallbacks)));
console.log('required names present', ['gridLink', 'listRowLink', 'likersHeading', 'commentList', 'postPermalink'].every((n) => S.SELECTORS[n]));

const schema = await import('../src/storage/schema.js');
const deep = schema.buildConfig({}, { preset: 'deep' });
const custom = schema.buildConfig(
  { custom: { resources: { profile: false, posts: true, comments: true } }, caps: { maxPosts: 3 } },
  { preset: 'custom', resources: { reels: true }, caps: { maxPosts: 7 } }
);
console.log('deep caps', deep.caps, 'pacing', deep.pacing);
console.log('custom resources', custom.resources, 'caps', custom.caps);
console.log('bad username', JSON.stringify(schema.normalizeUsername('https://instagram.com/reel/abc/')));
console.log('username', schema.normalizeUsername('@some.user'));
