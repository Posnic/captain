/*
 * A BUILD THAT CANNOT IDENTIFY ITSELF MAKES EVERY FIELD REPORT AMBIGUOUS.
 *
 * Every release APK went out as versionCode 1, versionName "1.0" - the
 * Capacitor default nobody changed. Every build looked identical to Android,
 * to the Play tooling, and to the person holding the phone.
 *
 * So when a shopkeeper installed a fix and said "I updated and nothing
 * changed", it could not be answered: nobody could tell whether the update had
 * taken, and an afternoon went into guessing at a bug that might already have
 * been fixed on that handset.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const stamp = require(path.join(root, 'scripts', 'build-version.js'));

test('a semver becomes one increasing integer', () => {
  /* Derived rather than counted, so it cannot drift from the version string
     the way a hand-maintained counter does. */
  assert.equal(stamp.versionCode('1.2.2'), 10202);
  assert.equal(stamp.versionCode('1.2.3'), 10203);
  assert.equal(stamp.versionCode('2.0.0'), 20000);
  assert.equal(stamp.versionCode('0.9.13'), 913);
});

test('the code always increases with the version', () => {
  /* The one failure a version code must not have: Android refuses an install
     whose code is not higher, so a pair out of order strands every handset. */
  const versions = ['0.9.9', '1.0.0', '1.0.1', '1.2.2', '1.10.0', '2.0.0', '10.0.0'];
  const codes = versions.map(stamp.versionCode);
  for (let i = 1; i < codes.length; i++) {
    assert.ok(codes[i] > codes[i - 1], `${versions[i]} did not outrank ${versions[i - 1]}`);
  }
});

test('a part above the arithmetic is capped rather than left to collide', () => {
  /* 1.100.0 would otherwise carry into the major and claim to be 2.0.0. */
  assert.ok(stamp.versionCode('1.100.0') < stamp.versionCode('2.0.0'));
  assert.ok(stamp.versionCode('1.2.150') < stamp.versionCode('1.3.0'));
});

test('rubbish is a version code, not a crash', () => {
  for (const value of ['', 'abc', null, undefined, '1']) {
    assert.equal(typeof stamp.versionCode(value), 'number');
  }
});

test('the tag wins over package.json, because a release IS its tag', () => {
  const before = process.env.POSNIC_VERSION;
  process.env.POSNIC_VERSION = 'v9.9.9';
  try {
    assert.equal(stamp.resolveVersion(root), '9.9.9');
  } finally {
    if (before === undefined) delete process.env.POSNIC_VERSION;
    else process.env.POSNIC_VERSION = before;
  }
});

test('a CI tag ref is understood', () => {
  const beforeVersion = process.env.POSNIC_VERSION;
  const beforeRef = process.env.GITHUB_REF;
  delete process.env.POSNIC_VERSION;
  process.env.GITHUB_REF = 'refs/tags/v1.2.3';
  try {
    assert.equal(stamp.resolveVersion(root), '1.2.3');
  } finally {
    if (beforeVersion === undefined) delete process.env.POSNIC_VERSION;
    else process.env.POSNIC_VERSION = beforeVersion;
    if (beforeRef === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = beforeRef;
  }
});

test('the gradle file actually gets both values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-gradle-'));
  const gradlePath = path.join(dir, 'build.gradle');
  fs.writeFileSync(
    gradlePath,
    ['android {', '    defaultConfig {', '        versionCode 1', '        versionName "1.0"', '    }', '}'].join('\n')
  );

  assert.equal(stamp.stampGradle(gradlePath, '1.2.2'), true);
  const after = fs.readFileSync(gradlePath, 'utf8');
  assert.match(after, /versionCode 10202/);
  assert.match(after, /versionName "1\.2\.2"/);
  /* And the default it replaced is gone, not merely joined. */
  assert.ok(!/versionCode 1$/m.test(after));
});

test('a missing gradle file is survivable', () => {
  assert.equal(stamp.stampGradle(path.join(os.tmpdir(), 'nope', 'build.gradle'), '1.0.0'), false);
});

test('the bundle gets a file the page can load before it draws', () => {
  /* A plain script rather than something to fetch, so a screen never has to
     wait to say which build it is. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-dist-'));
  assert.equal(stamp.stampBundle(dir, { version: '1.2.2', commit: 'abc1234' }), true);

  const written = fs.readFileSync(path.join(dir, 'app-build.js'), 'utf8');
  assert.match(written, /window\.POSNIC_BUILD/);
  assert.match(written, /1\.2\.2/);
  assert.match(written, /abc1234/);

  /* It has to be runnable, not merely present. */
  const sandbox = {};
  new Function('window', written)(sandbox);
  assert.equal(sandbox.POSNIC_BUILD.version, '1.2.2');
});

test('both builds stamp, so neither platform is the one nobody can identify', () => {
  const apk = fs.readFileSync(path.join(root, 'build-apk.js'), 'utf8');
  const ipa = fs.readFileSync(path.join(root, 'build-ipa.js'), 'utf8');
  for (const [name, source] of [['build-apk.js', apk], ['build-ipa.js', ipa]]) {
    assert.match(source, /stampBundle/, `${name} does not stamp the bundle`);
  }
  assert.match(apk, /stampGradle/, 'build-apk.js does not stamp the manifest version');
});

test('the page loads the stamp, and says something sensible without it', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /app-build\.js/);
  /* NOT build-version.js: that is the NODE build script, and the first draft
     pointed the page at it - so the browser loaded it, hit `require`, and threw
     on every page load. */
  assert.ok(!/src="build-version\.js"/.test(html), 'the page loads the Node build script');
  /* At a desk the file is absent; the app says "dev", which is true. */
  assert.match(html, /Captain dev build/);
});

test('package.json is not left behind the releases', () => {
  /* It was 1.0.0 while the tags were at 1.2.2, which is how the default
     version survived unnoticed for so long. */
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.notEqual(pkg.version, '1.0.0');
});
