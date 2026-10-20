'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const mark = fs.readFileSync(path.join(root, 'assets/common/captain-mark.svg'), 'utf8');
const foreground = Buffer.from(mark.replace(/<rect[^>]+\/>/, '').replace('<g stroke=', '<g transform="translate(7 13) scale(.85)" stroke='));
const opaque = Buffer.from(mark.replace('rx="25"', 'rx="0"'));

async function png(source, size, target, transparent = false) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let image = sharp(source).resize(size, size);
  if (!transparent) image = image.flatten({background:'#087F8C'}).removeAlpha();
  await image.png().toFile(target);
}
async function splash(target) {
  const {width, height} = await sharp(target).metadata();
  const size = Math.round(Math.min(width, height) * 0.25);
  const icon = await sharp(Buffer.from(mark)).resize(size, size).png().toBuffer();
  const data = await sharp({create:{width,height,channels:4,background:'#ffffff'}})
    .composite([{input:icon,gravity:'centre'}]).png().toBuffer();
  fs.writeFileSync(target, data);
}
async function install(platform) {
  if (platform === 'android') {
    const res = path.join(root, 'android/app/src/main/res');
    for (const [density, size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) {
      for (const name of ['ic_launcher','ic_launcher_round']) {
        await png(opaque, size, path.join(res, `mipmap-${density}/${name}.png`));
      }
      await png(foreground, size * 108 / 48, path.join(res, `mipmap-${density}/ic_launcher_foreground.png`), true);
    }
    fs.writeFileSync(path.join(res, 'values/ic_launcher_background.xml'), '<resources><color name="ic_launcher_background">#087F8C</color></resources>\n');
    for (const name of ['ic_launcher','ic_launcher_round']) {
      const dir = path.join(res, 'mipmap-anydpi-v26');
      fs.mkdirSync(dir, {recursive:true});
      fs.writeFileSync(path.join(dir, name+'.xml'), '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/><monochrome android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n');
    }
    for (const dir of fs.readdirSync(res)) {
      const file = path.join(res, dir, 'splash.png');
      if (fs.existsSync(file)) await splash(file);
    }
  } else if (platform === 'ios') {
    const assets = path.join(root, 'ios/App/App/Assets.xcassets');
    const iconDir = path.join(assets, 'AppIcon.appiconset');
    await png(opaque, 1024, path.join(iconDir, 'AppIcon-512@2x.png'));
    fs.writeFileSync(path.join(iconDir, 'Contents.json'), JSON.stringify({images:[{filename:'AppIcon-512@2x.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'Posnic',version:1}},null,2)+'\n');
    const splashDir = path.join(assets, 'Splash.imageset');
    if (fs.existsSync(splashDir)) for (const file of fs.readdirSync(splashDir)) {
      if (file.endsWith('.png')) await splash(path.join(splashDir,file));
    }
  } else throw new Error('Choose android or ios');
  console.log(`Captain branding installed for ${platform}`);
}
install(process.argv[2]).catch(error => {console.error(error);process.exitCode=1;});
