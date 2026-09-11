#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function readDirectories(dir) {
  try {
    return fs.readdirSync(dir).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;

  const candidates = [
    path.join(__dirname, '.android-build-tools', 'jdk17'),
    // Reuse the existing local toolchain during migration from apk-converter.
    path.resolve(__dirname, '..', 'apk-converter', '.android-build-tools', 'jdk17'),
    'E:\\Android\\jbr',
    'E:\\Android\\jre',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jre',
    ...readDirectories('C:\\Program Files\\Eclipse Adoptium'),
    ...readDirectories('C:\\Program Files\\Microsoft'),
    ...readDirectories('C:\\Program Files\\Java').filter((dir) => /jdk/i.test(dir))
  ];

  return candidates.find((dir) => fs.existsSync(path.join(dir, 'bin', 'java.exe'))) || null;
}

function run(command, cwd = __dirname) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit', cwd });
}

/*
 * The same commands, spelled the way each platform spells them.
 *
 * This script hard-coded npm.cmd, npx.cmd and gradlew.bat, so it ran on
 * Windows and nowhere else - which is why building an APK meant having the
 * whole Android toolchain on one particular laptop. A CI runner already has
 * that toolchain installed; it just could not run this file.
 */
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';
/* `.\` matters: cmd.exe on a machine with NoDefaultCurrentDirectoryInExePath
   set does not resolve a command from the working directory, and the failure
   it prints - "not recognized as an operable program" - reads as if Gradle
   were missing rather than unqualified. Cost a full build to find. */

const javaHome = resolveJavaHome();
if (!javaHome) {
  console.error('\nJAVA_HOME is not set and no JDK was found. Install Android Studio/JDK 17 or set JAVA_HOME.');
  process.exit(1);
}

process.env.JAVA_HOME = javaHome;
process.env.PATH = `${path.join(javaHome, 'bin')};${process.env.PATH}`;
console.log(`Using JDK: ${javaHome}`);

/*
 * An SDK path is only worth honouring if an SDK is actually there.
 *
 * This trusted ANDROID_HOME on sight. On a machine where it is set
 * system-wide to another user's profile - `C:\Users\office\...`, left behind
 * by whoever installed Android Studio - the build inherited a path that does
 * not exist, skipped the local toolchain sitting right next to it, and failed
 * in Gradle with "SDK location not found" a minute later. The env var names a
 * location; it does not promise one.
 */
const looksLikeSdk = (dir) =>
  !!dir && fs.existsSync(path.join(dir, 'platforms')) && fs.existsSync(path.join(dir, 'build-tools'));

if (!looksLikeSdk(process.env.ANDROID_HOME) && !looksLikeSdk(process.env.ANDROID_SDK_ROOT)) {
  /* Said before anything is reassigned, so the person who set it wrong finds
     out from one line instead of from a Gradle error a minute later. */
  for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[name]) console.log(`Ignoring ${name} (no SDK there): ${process.env[name]}`);
  }

  const localSdk = path.join(__dirname, '.android-build-tools', 'android-sdk');
  const legacyLocalSdk = path.resolve(__dirname, '..', 'apk-converter', '.android-build-tools', 'android-sdk');
  const defaultSdk = path.join('C:\\Users', os.userInfo().username, 'AppData', 'Local', 'Android', 'Sdk');
  const sdk = fs.existsSync(localSdk)
    ? localSdk
    : fs.existsSync(defaultSdk)
      ? defaultSdk
      : fs.existsSync(legacyLocalSdk)
        ? legacyLocalSdk
        : null;

  if (sdk) {
    process.env.ANDROID_HOME = sdk;
    process.env.ANDROID_SDK_ROOT = sdk;
    process.env.PATH = `${path.join(sdk, 'platform-tools')};${path.join(sdk, 'cmdline-tools', 'latest', 'bin')};${process.env.PATH}`;
    console.log(`Using Android SDK: ${sdk}`);
  }
}

const isRelease = process.argv.includes('--release');
const gradleTask = isRelease ? 'assembleRelease' : 'assembleDebug';
const apkRelativePath = isRelease
  ? path.join('app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : path.join('app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const androidDir = path.join(__dirname, 'android');

console.log(`\nBuilding Captain ${isRelease ? 'release' : 'debug'} APK...`);
run(`${npm} run build`);

if (!fs.existsSync(androidDir)) {
  run(`${npx} cap add android`);
}

run(`${npx} cap sync android`);

const javaSourceDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'posnic', 'captain');
const javaTemplateDir = path.join(__dirname, 'android-templates');
fs.mkdirSync(javaSourceDir, { recursive: true });
for (const fileName of ['MainActivity.java', 'LocalNetworkPlugin.java']) {
  fs.copyFileSync(
    path.join(javaTemplateDir, fileName),
    path.join(javaSourceDir, fileName)
  );
}

const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
const signingGradleName = 'release-signing.gradle';
fs.copyFileSync(
  path.join(javaTemplateDir, signingGradleName),
  path.join(androidDir, 'app', signingGradleName)
);
let appGradle = fs.readFileSync(appGradlePath, 'utf8');
const signingApply = `apply from: '${signingGradleName}'`;
if (!appGradle.includes(signingApply)) {
  appGradle += `\n${signingApply}\n`;
  fs.writeFileSync(appGradlePath, appGradle, 'utf8');
}

const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  const networkSecurityPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
  fs.mkdirSync(path.dirname(networkSecurityPath), { recursive: true });
  fs.writeFileSync(
    networkSecurityPath,
    '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n    <base-config cleartextTrafficPermitted="true" />\n</network-security-config>\n',
    'utf8'
  );

  let manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  }
  if (!manifest.includes('networkSecurityConfig')) {
    manifest = manifest.replace('<application', '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  }

  /*
   * The camera, for scanning the shop's code.
   *
   * Without this the scanner does not fail loudly: getUserMedia rejects with
   * NotAllowedError and the screen reports the camera as blocked, sending
   * somebody into Settings to grant a permission the app never asked for.
   * required="false" so a device without a camera can still install and use
   * the other two ways in.
   */
  if (!manifest.includes('android.permission.CAMERA')) {
    const camera = [
      '<uses-permission android:name="android.permission.CAMERA" />',
      '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
      '',
      '    <application',
    ].join('\n');
    manifest = manifest.replace('<application', camera);
  }
  fs.writeFileSync(manifestPath, manifest, 'utf8');
}

if (!isWindows) {
  /* `cap add android` can write the wrapper without the execute bit, and
     Gradle is the last step, so it would fail several minutes in. */
  try { fs.chmodSync(path.join(androidDir, 'gradlew'), 0o755); } catch (e) { /* already fine */ }
}

/* The wrapper by absolute path, quoted.
   Invoking it as a bare `gradlew.bat` relies on cmd.exe resolving a command
   from the working directory, which a machine with
   NoDefaultCurrentDirectoryInExePath set does not do - and the error it
   prints, "not recognized as an operable program", reads as if Gradle were
   missing rather than merely unqualified. An absolute path needs no PATH
   lookup and no shell-specific prefix. */
run(`"${path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew')}" ${gradleTask}`, androidDir);

const apkPath = path.join(androidDir, apkRelativePath);
if (!fs.existsSync(apkPath)) {
  throw new Error(`Gradle completed but APK was not found: ${apkPath}`);
}

if (isRelease) {
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  const buildToolsRoot = sdkRoot ? path.join(sdkRoot, 'build-tools') : null;
  const buildTools = buildToolsRoot
    ? readDirectories(buildToolsRoot).sort((a, b) => path.basename(b).localeCompare(path.basename(a), undefined, { numeric: true }))
    : [];
  const apkSigner = buildTools
    .map((dir) => path.join(dir, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'))
    .find((file) => fs.existsSync(file));

  if (!apkSigner) throw new Error('apksigner was not found in the Android SDK build-tools.');
  run(`"${apkSigner}" verify --verbose "${apkPath}"`, androidDir);
}

console.log(`\nAPK built successfully: ${apkPath}`);
