/*
 * THE WAITER'S LANGUAGE.
 *
 * Every word in this app is English in the source. The till beside it already
 * speaks Tamil; the phone in the waiter's hand did not, and the staff least
 * likely to be comfortable in English are exactly the ones holding it.
 *
 * WHY THE ENGLISH SENTENCE IS THE KEY. Two hundred invented names like
 * lang_move_table_2 would have to be made up, looked up, and kept in step with
 * the markup using them. The sentence is already unique, already in the
 * markup, and reads as what it is. A sentence with no translation shows the
 * English, which is a worse screen than Tamil and a far better one than a key.
 *
 * WHY A WALKER RATHER THAN TAGGED MARKUP. This app draws most of what it says
 * from script: a card, a count, a line on a bill, a sheet built the moment it
 * opens. Marking every string in every template would touch thousands of lines
 * to no benefit, and would still miss the next one somebody writes. The walker
 * translates a text node whose WHOLE trimmed text is a sentence it knows, and
 * an observer does the same for nodes that arrive later.
 *
 * WHAT IS NEVER TRANSLATED, by construction rather than by rule: dish names,
 * category names, the shop's own name, table numbers, prices - anything a shop
 * typed into its own till. None of them are in the dictionary, and a
 * whole-text match cannot half-translate a line.
 *
 * The English is remembered per node, so switching back is exact rather than a
 * translation of a translation.
 */

(function (root) {
  'use strict';

  const STORED = 'posnic.language';

  /** code -> { 'English sentence': 'translation' } */
  const packs = {};

  /** node -> the English it arrived with, so a switch back is exact. */
  const English = new WeakMap();

  let current = 'en';
  let watching = false;

  /** Somewhere for a pack to land, whichever file loads first. */
  function register(code, words) {
    if (!code || !words) return;
    packs[code] = Object.assign(packs[code] || {}, words);
  }

  const pack = () => packs[current] || null;

  /*
   * One sentence, asked for by script. A line built around a number ("3
   * dishes") cannot be matched whole, so the script asks for the words and
   * puts the number where this language wants it.
   */
  function t(sentence, fallback) {
    const said = String(sentence == null ? '' : sentence);
    const words = pack();
    if (!words) return fallback == null ? said : fallback;
    return words[said.trim()] || (fallback == null ? said : fallback);
  }

  /** The translation of some text, keeping the markup's own spacing. */
  function swapped(said) {
    const words = pack();
    if (!words) return null;

    const trimmed = String(said).trim();
    if (!trimmed) return null;

    const translation = words[trimmed];
    if (!translation) return null;

    /* A sentence that sat on its own indented line stays on it. */
    return String(said).replace(trimmed, translation);
  }

  function translateTextNode(node) {
    const original = English.has(node) ? English.get(node) : node.nodeValue;

    if (current === 'en') {
      if (English.has(node) && node.nodeValue !== original) node.nodeValue = original;
      return;
    }

    const next = swapped(original);
    if (next == null || next === node.nodeValue) return;

    if (!English.has(node)) English.set(node, original);
    node.nodeValue = next;
  }

  /* Words people read that are not text nodes. */
  const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];

  const keptAs = (name) => 'en' + name.replace(/(^|-)([a-z])/g, (m, dash, c) => c.toUpperCase());

  function translateAttributes(element) {
    if (!element.hasAttribute || !element.dataset) return;

    for (const name of ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;

      const mark = keptAs(name);
      const original =
        element.dataset[mark] != null ? element.dataset[mark] : element.getAttribute(name);

      if (current === 'en') {
        if (element.dataset[mark] != null) element.setAttribute(name, original);
        continue;
      }

      const next = swapped(original);
      if (next == null || next === element.getAttribute(name)) continue;

      element.dataset[mark] = original;
      element.setAttribute(name, next);
    }
  }

  /* These hold text that is not for reading. A textarea holds what somebody
     typed, which is theirs. */
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);

  function apply(node) {
    if (!node) return;

    if (node.nodeType === 3) {
      if (node.parentElement && SKIP.has(node.parentElement.tagName)) return;
      translateTextNode(node);
      return;
    }

    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;

    translateAttributes(node);

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (text) =>
        text.parentElement && SKIP.has(text.parentElement.tagName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });

    let text = walker.nextNode();
    while (text) {
      translateTextNode(text);
      text = walker.nextNode();
    }

    if (node.querySelectorAll) {
      for (const name of ATTRIBUTES) {
        const marked = node.querySelectorAll('[' + name + ']');
        for (let i = 0; i < marked.length; i += 1) translateAttributes(marked[i]);
      }
    }
  }

  /*
   * Everything drawn after the first paint, which here is most of it. One
   * observer on the document rather than a call at the end of every render:
   * a screen somebody writes next year is covered without them ever learning
   * that this file exists.
   */
  function watch() {
    if (watching || typeof MutationObserver !== 'function') return;
    watching = true;

    new MutationObserver((records) => {
      if (current === 'en') return;
      for (const record of records) {
        for (let i = 0; i < record.addedNodes.length; i += 1) apply(record.addedNodes[i]);
        if (record.type === 'characterData') apply(record.target);

        /*
         * A placeholder set on an element that was already here. Watching only
         * added nodes covers markup and anything built with innerHTML, and
         * misses `box.placeholder = 'Search the menu'` entirely: the element is
         * not new, so nothing is added and nothing gets translated.
         *
         * This cannot loop. Translating writes the English into the node's
         * dataset first, so the next pass reads the same English, produces the
         * same translation, sees it is already there and stops.
         */
        if (record.type === 'attributes') translateAttributes(record.target);
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES,
    });
  }

  /*
   * WHO DECIDES, in order: what this phone was set to, then the phone's own
   * language, then English. A handset is set up once by whoever hands it to a
   * waiter, so the stored answer outranks the phone.
   */
  function preferred() {
    try {
      const kept = localStorage.getItem(STORED);
      if (kept) return kept;
    } catch (e) {
      /* A phone with storage turned off still gets a language. */
    }

    const phone = String((navigator && navigator.language) || '').toLowerCase();
    return phone.indexOf('ta') === 0 ? 'ta' : 'en';
  }

  function use(code, options) {
    current = packs[code] ? code : 'en';

    if (!options || options.remember !== false) {
      try {
        localStorage.setItem(STORED, current);
      } catch (e) {
        /* Not being able to remember it is no reason to refuse to change it. */
      }
    }

    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', current);
      apply(document.body || document.documentElement);
    }

    return current;
  }

  function start() {
    /*
     * A pack that loaded before this file left itself here. Either order of
     * script tags works, so a page that lists them the other way round is not
     * a page silently stuck in English.
     */
    if (root.POSNIC_LANG_TA) {
      register('ta', root.POSNIC_LANG_TA);
      delete root.POSNIC_LANG_TA;
    }

    use(preferred(), { remember: false });
    watch();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  root.I18N = {
    register,
    t,
    use,
    start,
    apply,
    known: () => ['en'].concat(Object.keys(packs)),
    language: () => current,
  };
})(typeof window !== 'undefined' ? window : globalThis);
