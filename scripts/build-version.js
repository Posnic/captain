'use strict';
/*
 * Which build is this, and how a phone can say so.
 *
 * WHY THIS EXISTS. Every release APK went out as versionCode 1, versionName
 * "1.0" - the Capacitor default nobody changed. Every build looked identical
 * to Android, to the Play tooling, and to the person holding the phone. So
 * when a shopkeeper installed a fix and reported "nothing changed", there was
 * no way to tell whether the update had taken, and a real afternoon went into
 * guessing at a bug that might already have been fixed on their handset.
 *
 * A build that cannot identify itself makes every field report ambiguous.
 *
 * Two places carry it now. The MANIFEST, so Android can tell one build from
 * the next and refuse a downgrade; and the BUNDLE, so the app can print it on
 * the connect screen where somebody reading it out over the phone will look.
 *
 * versionCode is derived rather than counted, so it cannot drift from the tag:
 * 1.2.2 becomes 10202, which increases monotonically for any sane version and
 * leaves room for ninety-nine of each part.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * The version this build should claim.
 *
 * The tag wins, because a release IS its tag. package.json is the fallback for
 * a build somebody made at a desk, and it is allowed to be behind - a desk
 * build is not a release and should not pretend to be one.
 */
function resolveVersion(root) {
  const fromEnv = String(process.env.POSNIC_VERSION || '').trim();
  if (fromEnv) return fromEnv.replace(/^v/, '');

  /* GitHub sets this on a tag build: refs/tags/v1.2.2 */
  const ref = String(process.env.GITHUB_REF || '');
  const tagged = ref.match(/^refs\/tags\/v?(.+)$/);
  if (tagged) return tagged[1];

  /*
   * On a tag, that tag. Off a tag, how far past the last one.
   *
   * `--exact-match` alone answers nothing for a build that is not a release,
   * and the next fallback is package.json - which is written by hand and was
   * eleven commits stale when a real emulator run stamped itself "1.2.2". A
   * build that misreports its own version is worse than one that admits it is
   * not a release: `1.2.4-6-gb0c9750` is unambiguous, and says at a glance
   * that this is six commits past v1.2.4 rather than a version anybody shipped.
   */
  for (const command of ['git describe --tags --exact-match', 'git describe --tags --always']) {
    try {
      const described = execSync(command, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (described) return described.replace(/^v/, '');
    } catch (e) {
      /* not on a tag, or no tags at all - try the next, then package.json */
    }
  }

  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

/** The short commit, so two builds of one version are still tellable apart. */
function resolveCommit(root) {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (e) {
    return '';
  }
}

/**
 * A semver as one increasing integer, for Android.
 *
 * Derived rather than counted, so it cannot drift from the version string the
 * way a hand-maintained counter does. Each part is capped at 99 because that
 * is what the arithmetic allows, and a part above it would silently collide
 * with the next one up - which is the one failure mode a version code must
 * not have.
 */
function versionCode(version) {
  const [major, minor, patch] = String(version)
    .split('.')
    .map((part) => Math.min(99, Math.max(0, parseInt(part, 10) || 0)));
  return (major || 0) * 10000 + (minor || 0) * 100 + (patch || 0);
}

/** Stamp the Android manifest's gradle file. */
function stampGradle(gradlePath, version) {
  if (!fs.existsSync(gradlePath)) return false;
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode(version)}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  fs.writeFileSync(gradlePath, gradle, 'utf8');
  return true;
}

/**
 * Write the version into the web bundle.
 *
 * A plain script rather than something to fetch, so the app has it before it
 * draws anything and a screen never has to wait to say which build it is.
 * index.html loads it with no `defer`; at a desk the file is absent and the
 * app says "dev", which is true.
 *
 * Named app-build.js and NOT build-version.js. The first draft used the
 * latter, which is also the name of THIS file - so the browser loaded the
 * Node build script, hit `require`, and threw on every page load. A live
 * browser test found it inside a minute; nothing else would have.
 */
function stampBundle(distDir, build) {
  if (!fs.existsSync(distDir)) return false;
  fs.writeFileSync(
    path.join(distDir, 'app-build.js'),
    `/* Written at build time by scripts/build-version.js. Do not edit. */\n` +
      `window.POSNIC_BUILD = ${JSON.stringify(build)};\n`,
    'utf8'
  );
  return true;
}

module.exports = { resolveVersion, resolveCommit, versionCode, stampGradle, stampBundle };
