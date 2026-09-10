#!/usr/bin/env node
/*
 * Build the iOS app.
 *
 * macOS only, and not by choice: an iOS binary is produced by Xcode, and Apple
 * ships Xcode for nothing else. So this runs on a macOS CI runner rather than
 * on the machine the rest of this repo is developed on.
 *
 * Two outcomes, and the difference matters:
 *
 *   unsigned  - no certificate available. Proves the app compiles and produces
 *               a .ipa you can inspect, and that is all: it will not install on
 *               a phone. This is what every fork and every pull request gets,
 *               and it is worth having, because "does it still build for iOS"
 *               is the question that otherwise goes unanswered for months.
 *   signed    - a distribution certificate and provisioning profile are in the
 *               environment, so xcodebuild exports an installable build.
 *
 * The mode is decided by what is present, never by a flag, so the same command
 * works in both places and nobody has to remember which to pass.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const iosDir = path.join(root, 'ios');
const appDir = path.join(iosDir, 'App');
const outDir = path.join(root, 'build-output');

function run(command, cwd = root) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit', cwd });
}

if (process.platform !== 'darwin') {
  console.error('\niOS builds require macOS and Xcode. On other platforms use the CI workflow.');
  process.exit(1);
}

/*
 * The declarations iOS needs, merged in after the project is generated.
 *
 * `npx cap add ios` regenerates ios/ from scratch, so anything edited into the
 * generated Info.plist is lost on the next run - and the symptom is not a build
 * failure. It is an app that installs, launches, and then cannot see the shop's
 * till, which looks like a bug in the discovery code. Kept in ios-templates/
 * and applied here so that cannot happen.
 */
function mergeInfoPlist() {
  const additions = path.join(root, 'ios-templates', 'Info.plist.additions.xml');
  const target = path.join(appDir, 'App', 'Info.plist');
  if (!fs.existsSync(additions) || !fs.existsSync(target)) return;

  const block = fs.readFileSync(additions, 'utf8');
  /* The file is commented for a reader; only the <dict> body is plist. */
  const body = block.slice(block.indexOf('<dict>') + '<dict>'.length, block.lastIndexOf('</dict>'));

  let plist = fs.readFileSync(target, 'utf8');
  if (plist.includes('NSLocalNetworkUsageDescription')) {
    console.log('Info.plist already carries the local-network declarations.');
    return;
  }
  /* Into the root dict, immediately after it opens. */
  const at = plist.indexOf('<dict>') + '<dict>'.length;
  plist = plist.slice(0, at) + body + plist.slice(at);
  fs.writeFileSync(target, plist, 'utf8');
  console.log('Info.plist: added ATS and local-network declarations.');
}

const teamId = process.env.IOS_TEAM_ID || '';
const profileName = process.env.IOS_PROVISIONING_PROFILE_NAME || '';
const bundleId = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8')).appId;
const canSign = !!(teamId && profileName);

console.log(`
Building Captain for iOS (${canSign ? 'signed' : 'unsigned'})...`);

run('npm run build');
if (!fs.existsSync(iosDir)) run('npx cap add ios');
run('npx cap sync ios');
mergeInfoPlist();

fs.mkdirSync(outDir, { recursive: true });
const archivePath = path.join(outDir, 'Captain.xcarchive');

/*
 * Archive unsigned, always, and sign at export.
 *
 * The obvious thing - passing CODE_SIGN_IDENTITY and PROVISIONING_PROFILE to
 * xcodebuild - applies them to EVERY target in the workspace, and a
 * CocoaPods project is mostly framework targets. Those cannot take a
 * provisioning profile, so the build stops with "Pods-App does not support
 * provisioning profiles", naming a target nobody here wrote and did not mean
 * to sign.
 *
 * Signing at export sidesteps it entirely: one app bundle, one profile, and
 * the frameworks inside it are re-signed with the same identity as a
 * consequence rather than by instruction.
 */
run([
  'xcodebuild',
  '-workspace App.xcworkspace',
  '-scheme App',
  '-configuration Release',
  '-sdk iphoneos',
  `-archivePath "${archivePath}"`,
  'archive',
  'CODE_SIGNING_ALLOWED=NO',
  'CODE_SIGNING_REQUIRED=NO',
  'CODE_SIGN_IDENTITY=""',
].join(' '), appDir);

const ipaPath = path.join(outDir, canSign ? 'Captain.ipa' : 'Captain-unsigned.ipa');

if (canSign) {
  const method = process.env.IOS_EXPORT_METHOD || 'ad-hoc';
  const optionsPath = path.join(outDir, 'ExportOptions.plist');
  fs.writeFileSync(optionsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${method}</string>
    <key>teamID</key>
    <string>${teamId}</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>compileBitcode</key>
    <false/>
    <key>stripSwiftSymbols</key>
    <true/>
    <!-- Only the app is named. The frameworks are re-signed as a consequence
         of signing what contains them. -->
    <key>provisioningProfiles</key>
    <dict>
        <key>${bundleId}</key>
        <string>${profileName}</string>
    </dict>
</dict>
</plist>
`, 'utf8');

  run([
    'xcodebuild',
    '-exportArchive',
    `-archivePath "${archivePath}"`,
    `-exportPath "${outDir}"`,
    `-exportOptionsPlist "${optionsPath}"`,
  ].join(' '), appDir);

  /* xcodebuild names the export after the scheme. */
  const exported = path.join(outDir, 'App.ipa');
  if (fs.existsSync(exported)) fs.renameSync(exported, ipaPath);
} else {
  /*
   * An .ipa is a zip with the .app inside Payload/. Assembled by hand because
   * -exportArchive refuses to run without a signing identity, and an artifact
   * somebody can unzip and inspect is more use than no artifact at all.
   */
  const appPath = path.join(archivePath, 'Products', 'Applications', 'App.app');
  if (!fs.existsSync(appPath)) throw new Error(`Archive built but App.app was not found: ${appPath}`);

  const payload = path.join(outDir, 'Payload');
  fs.rmSync(payload, { recursive: true, force: true });
  fs.mkdirSync(payload, { recursive: true });
  run(`cp -R "${appPath}" "${payload}/"`);
  run(`cd "${outDir}" && zip -qry "${path.basename(ipaPath)}" Payload`);
  fs.rmSync(payload, { recursive: true, force: true });
}

if (!fs.existsSync(ipaPath)) throw new Error(`Build completed but no .ipa was produced: ${ipaPath}`);
console.log(`\nBuilt: ${ipaPath}${canSign ? '' : '  (unsigned - will not install on a device)'}`);
