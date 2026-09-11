/*
 * indexedDB.js is loaded by EVERY page, and must not assume any one of them.
 *
 * WHAT HAPPENED. The menu was rewritten and loadProducts started calling
 * MenuScreen.draw(). Login also calls loadProducts - to fill `products` the
 * moment a branch's items arrive, before it redirects - and on the login page
 * there is no MenuScreen, because only products.html loads it.
 *
 * The ReferenceError threw inside an await. Nothing stopped, nothing printed
 * anywhere a person would look, and the login simply never redirected: the
 * screen sat there looking like a server that had not answered. Twenty-three
 * browser tests went red and not one of them said "MenuScreen".
 *
 * This is the same shape as the `root` bug in assets/common/self-test.js - a
 * name that exists in one context reached for in another - and it earns a test
 * for the same reason: the symptom never names the cause.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/** Which globals a page has to load a script of its own to get. */
const PAGE_ONLY = ['MenuScreen', 'MenuView', 'ItemSearch', 'Speech', 'VoiceOrderUI'];

test('shared code does not assume a page-only global is there', () => {
  const source = fs.readFileSync(path.join(root, 'indexedDB.js'), 'utf8');

  /*
   * Per function, not per line.
   *
   * The guard is usually an early return several lines above the use, and it
   * protects everything after it - so a line-by-line check reports the real
   * guard as the violation. What matters is that a function reaching for one
   * of these names has said somewhere that it might not be there.
   */
  const functions = source.split(/\n(?=(?:async )?function )/);

  const naked = [];
  for (const name of PAGE_ONLY) {
    const uses = new RegExp('\\b' + name + '\\s*\\.');
    const guarded = new RegExp('typeof\\s+' + name + '\\b');
    for (const body of functions) {
      /* Comments talk about these names constantly and call none of them. */
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (!uses.test(code) || guarded.test(code)) continue;
      const named = /^(?:async )?function (\w+)/.exec(body);
      naked.push((named ? named[1] : '(top level)') + ' uses ' + name);
    }
  }

  assert.deepEqual(
    naked,
    [],
    'indexedDB.js reaches for a page-only global unguarded: ' +
      naked.join('; ') +
      '. Every page loads this file; only some load those.'
  );
});

test('the page that draws the menu loads what draws it', () => {
  /* The other half of the same mistake: guarding the call and then forgetting
     the script tag would make the menu quietly never render. */
  const page = fs.readFileSync(path.join(root, 'products.html'), 'utf8');
  for (const file of ['assets/common/menu-view.js', 'assets/products/menu.js']) {
    assert.ok(page.includes(file), 'products.html does not load ' + file);
  }

  assert.ok(
    page.indexOf('assets/common/menu-view.js') < page.indexOf('assets/products/menu.js'),
    'menu-view.js must be loaded before menu.js, which calls it'
  );
});

test('a stylesheet that is linked exists', () => {
  /* A 404 on a stylesheet is silent: the page renders unstyled and looks like
     a design decision somebody made badly. */
  for (const page of ['index.html', 'products.html', 'cart.html']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const links = [...source.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
    for (const href of links) {
      if (/^https?:/.test(href)) continue;
      assert.ok(fs.existsSync(path.join(root, href)), page + ' links ' + href + ', which is not there');
    }
  }
});

test('a script that is linked exists', () => {
  for (const page of ['index.html', 'products.html', 'cart.html']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const links = [...source.matchAll(/<script[^>]+src="([^"?]+)[^"]*"/g)].map((m) => m[1]);
    for (const src of links) {
      if (/^https?:/.test(src)) continue;
      /* Written at build time by scripts/build-version.js, so it is correctly
         absent at a desk - where the app simply says "dev", which is true. */
      if (src.endsWith('app-build.js')) continue;
      assert.ok(fs.existsSync(path.join(root, src)), page + ' loads ' + src + ', which is not there');
    }
  }
});
