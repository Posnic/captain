/*
 * Turning "two chicken biryani and three coffee" into an order.
 *
 * The recogniser is the easy half to add and the hard half to trust. A
 * restaurant is loud, dish names are proper nouns, and generic speech
 * recognition mangles proper nouns more than anything else: "biryani" comes
 * back as "biriyani", "briyani", "bryani", sometimes "brianni".
 *
 * What saves it is that the answer is never open-ended. The words are matched
 * against THIS shop's menu, which is a few hundred items rather than a
 * language, so a mangled word usually has exactly one plausible neighbour.
 * That is also why voice matching is allowed to be tolerant where typing is
 * not: a waiter who types has seen what they typed, and a waiter who speaks
 * has not seen anything yet.
 *
 * TWO LAYERS, ON PURPOSE.
 *
 *   understand()  what was said, as dishes and quantities. It has no opinion
 *                 about what to DO with them.
 *   commands()    what was MEANT: add these, take those off, make it three,
 *                 send it to the kitchen. A waiter at a table talks in verbs,
 *                 and an app that only hears nouns makes them tap for the
 *                 rest.
 *
 * The verbs are a fixed list rather than anything cleverer, because a
 * restaurant needs the same dozen every night and a misread verb is worse
 * than a misread dish: "remove" heard as "add" doubles an order instead of
 * halving it. Where a shop has an AI provider configured the server can do
 * the reading instead (see voice-order-ui.js); this is what every shop gets.
 *
 * Nothing here orders anything. It produces commands for something else to
 * carry out, and the one that reaches a kitchen is never carried out without
 * a person pressing a button first.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VoiceOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* Spoken numbers, up to what anybody says in one breath at a table. Above
     twenty people say the digits, which the digit branch already handles. */
  const WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20,
    /* Recognisers hear these for small numbers more often than not. */
    to: 2, too: 2, for: 4, ate: 8,
  };

  const MAX = 99;

  /*
   * What a waiter says to change an order, grouped by what it means.
   *
   * Multi-word phrases are listed so they can be matched before their parts:
   * "take off" is a removal, "take" alone is nothing, and "send to kitchen"
   * must be seen before "to" is read as the number two.
   *
   * Removal is the shorter, more careful list. An extra way to say "add" that
   * is wrong costs one line somebody deletes; an extra way to say "remove"
   * that is wrong costs a dish the table asked for. "without" and "no" are
   * deliberately absent - "biryani without onion" and "no ice" are notes on a
   * dish, not dishes taken off.
   */
  const VERBS = {
    add: [
      'add', 'put', 'get me', 'get us', 'give me', 'give us', 'bring', 'bring me',
      'i want', 'we want', 'i need', 'we need', "i'd like", 'i would like', 'we would like',
      'order', 'also', 'plus', 'one more', 'another', 'include',
    ],
    remove: [
      'remove', 'delete', 'cancel', 'take off', 'take out', 'take away', 'minus', 'drop',
      'scrap', 'strike', 'no more', 'less', 'fewer', 'get rid of',
    ],
    set: ['make it', 'make that', 'change it to', 'change to', 'change that to', 'set', 'instead'],
    /* Whole-utterance commands: no dish follows them. */
    place: [
      'send to kitchen', 'send it to kitchen', 'send to the kitchen', 'send it to the kitchen',
      'send this to the kitchen', 'send the order', 'send it', 'send order', 'place order',
      'place the order', 'place this order', 'fire it', 'fire the order', 'submit order',
      'submit the order', 'confirm order', 'confirm the order', "that's all", 'thats all',
      'that is all', 'that will be all', 'all done', 'done', 'finish', 'finished', 'go ahead',
      'punch it', 'punch the order',
    ],
    clear: [
      'clear the cart', 'clear cart', 'clear everything', 'clear it', 'clear all', 'start over',
      'start again', 'empty the cart', 'empty cart', 'cancel everything', 'cancel the order',
      'cancel order', 'cancel all', 'remove everything', 'remove all', 'delete everything',
      'delete all', 'scrap it', 'scrap the order', 'forget it', 'forget that',
    ],
    show: [
      'show cart', 'show the cart', 'show me the cart', 'show order', 'show the order',
      "what's in the cart", 'whats in the cart', 'what is in the cart', 'read it back',
      'read back', 'read the order', 'repeat', 'repeat the order', 'what did i say',
      'what do we have', 'what have we got',
    ],
  };

  /* Longest phrase first, so "take off" is found before "take" could be. */
  const VERB_LIST = Object.keys(VERBS)
    .flatMap((verb) => VERBS[verb].map((phrase) => ({ verb, words: phrase.split(' ') })))
    .sort((a, b) => b.words.length - a.words.length);

  /* Words that carry no order in them. Stripped once, AFTER verbs are found,
     so every rule after this sees "chicken biryani" and not "some of the
     chicken biryani for the table please". */
  const FILLER = new Set([
    'please', 'kindly', 'the', 'some', 'of', 'um', 'uh', 'er', 'like', 'just', 'then', 'so',
    'okay', 'ok', 'now', 'can', 'could', 'you', 'we', 'i', 'me', 'us', 'for', 'table', 'them',
    'it', 'this', 'that', 'those', 'these',
  ]);

  /**
   * Split what was said into one phrase per dish.
   *
   * People separate items with commas, with "and", and with nothing at all.
   * The first two are reliable; the third is not, and is left alone rather
   * than guessed at - a wrong split invents an item that was never ordered.
   */
  function phrases(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\band\b/g, ',')
      .replace(/\bplus\b/g, ',')
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Pull the quantity off the front of one phrase.
   *
   * "two chicken biryani" -> 2, "chicken biryani"
   * "chicken biryani"     -> 1, "chicken biryani"
   *
   * Only the front. A number later in the phrase belongs to the dish -
   * "chicken 65" is a name, not sixty-five chickens - and that distinction is
   * the difference between an order and an incident.
   */
  function quantityOf(phrase) {
    const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { quantity: 1, term: '' };

    const digits = words[0].match(/^(\d{1,2})$/);
    if (digits && words.length > 1) {
      return { quantity: clamp(Number(digits[1])), term: words.slice(1).join(' ') };
    }

    const spoken = WORDS[words[0]];
    if (spoken && words.length > 1) {
      return { quantity: clamp(spoken), term: words.slice(1).join(' ') };
    }

    return { quantity: 1, term: words.join(' ') };
  }

  const clamp = (n) => Math.min(Math.max(n, 1), MAX);

  /**
   * What was said, as a list of things to look up.
   *
   * @param {string} text  a transcript
   * @returns {Array<{quantity: number, term: string}>}
   */
  function parse(text) {
    return phrases(text)
      .map(quantityOf)
      .filter((line) => line.term.length > 1);
  }

  /**
   * How close two words are, as a count of single-character edits.
   *
   * Only used for speech, and capped: a word is either nearly right or it is a
   * different word, and allowing three or four edits turns "coffee" into
   * "toffee" into "taffy" and puts something nobody ordered on the bill.
   */
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    /*
     * Two swapped letters count as one edit, not two.
     *
     * Transposition is the commonest way both a recogniser and a thumb get a
     * word wrong - "briyani" for "biryani" is two adjacent letters exchanged.
     * Plain Levenshtein charges two for that, which put the correct dish out
     * of reach of a one-edit budget while leaving genuinely different words
     * just as far away. Counting it as one is what makes a tight budget
     * usable: it forgives the common mistake without widening the net.
     */
    const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)];
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(rows[i - 1][j] + 1, current[j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          value = Math.min(value, rows[i - 2][j - 2] + 1);
        }
        current[j] = value;
        best = Math.min(best, value);
      }
      if (best > limit) return limit + 1;
      rows.push(current);
    }
    return rows[a.length][b.length];
  }

  /**
   * Match one spoken phrase to a menu item.
   *
   * The exact search runs first and usually wins: constraining to one shop's
   * menu does most of the work, and a transcript is often right. Only when
   * nothing matches at all is the tolerant pass tried, and it reports how it
   * matched so the screen can show a near-miss differently from a certainty.
   *
   * @param {Array} indexed  from ItemSearch.index()
   * @param {string} term
   * @param {object} search  the ItemSearch module
   * @returns {{item: object, exact: boolean}|null}
   */
  function matchOne(indexed, term, search) {
    /*
     * CERTAIN FIRST, THEN LIKELY, THEN ROUGH - and the caller is told which.
     *
     * `numbers` rewrites spoken numerals to digits, so "chicken sixty five"
     * reaches Chicken 65, which is how every board in Tamil Nadu writes it.
     * That is a deterministic rewrite rather than a guess, so a hit is as
     * certain as a typed one.
     *
     * `heard` also allows a PHONETIC match, so "briyani", "panner" and
     * "thosai" reach the right dish. That one is a guess, and it is reported
     * as a near match so the screen shows it to be confirmed rather than
     * adding it silently. Running both in one call would have collapsed that
     * distinction and quietly turned every guess into a certainty.
     */
    const found = search.search(indexed, term, { numbers: true });
    if (found.length) return { item: found[0], exact: true };

    const heard = search.search(indexed, term, { heard: true });
    if (heard.length) return { item: heard[0], exact: false };

    /* One edit for a short word, two for a long one. A five-letter word three
       edits away is a different word. */
    const spoken = search.fold(term);
    const limit = spoken.length > 7 ? 2 : 1;

    let best = null;
    let bestScore = limit + 1;
    for (const entry of indexed) {
      /* Compared word by word: a transcript gets one word wrong, not the
         whole name, and comparing whole names would let a long name absorb
         the difference. */
      for (const word of entry.words) {
        for (const said of spoken.split(' ')) {
          if (said.length < 4) continue; // too short to correct safely
          const d = distance(said, word, limit);
          if (d < bestScore) {
            bestScore = d;
            best = entry.item;
          }
        }
      }
    }
    return best ? { item: best, exact: false } : null;
  }

  /**
   * Everything that was said, matched against the menu.
   *
   * @returns {Array<{quantity, term, item, exact, found}>} in the order spoken
   */
  function understand(text, indexed, search) {
    return parse(text).map((line) => {
      const match = matchOne(indexed, line.term, search);
      return {
        quantity: line.quantity,
        term: line.term,
        item: match ? match.item : null,
        exact: !!(match && match.exact),
        found: !!match,
      };
    });
  }

  /* ------------------------------------------------------------- commands */

  /**
   * Words, lower-cased, with the punctuation a recogniser adds taken off.
   *
   * A comma is a token of its own, never glued to the word before it. The
   * first version left "kitchen," as one word, so "two dosa, send to kitchen,"
   * never matched "send to kitchen" and the order went in as three dishes -
   * one of them a kitchen. Two tests caught it before a waiter did.
   */
  function wordsOf(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[.!?;]+/g, ' , ')
      .replace(/,/g, ' , ')
      .replace(/[^a-z0-9,'\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /** The verb phrase that starts at this position, if any. */
  function verbAt(words, at) {
    for (const entry of VERB_LIST) {
      const n = entry.words.length;
      if (at + n > words.length) continue;
      let hit = true;
      for (let k = 0; k < n; k++) {
        if (words[at + k] !== entry.words[k]) {
          hit = false;
          break;
        }
      }
      if (hit) return { verb: entry.verb, length: n };
    }
    return null;
  }

  /**
   * What was MEANT, as a list of commands in the order they were said.
   *
   *   "add two coffee"                        -> [add 2 Coffee]
   *   "remove one coffee"                     -> [remove 1 Coffee]
   *   "two biryani and take off the coffee"   -> [add 2 Biryani, remove 1 Coffee]
   *   "make it three coffee"                  -> [set 3 Coffee]
   *   "send it to the kitchen"                -> [place]
   *   "two dosa, send to kitchen"             -> [add 2 Dosa, place]
   *   "clear the cart"                        -> [clear]
   *
   * Words before any verb are an addition, because that is what a waiter
   * reading an order off a table is doing. A verb starts a new command and
   * owns every dish until the next verb. "send to kitchen" and its kin own
   * nothing and are moved to the END whatever position they were said in -
   * "send it, and two more coffee" means both, in the only order that makes
   * sense. "clear" goes FIRST, so what follows is added to an empty cart.
   *
   * @returns {Array<{verb: string, lines: Array}>}
   */
  function commands(text, indexed, search) {
    const words = wordsOf(text);
    const out = [];
    let current = null;
    let trailing = null; // place / show, carried out last
    let clearFirst = false;

    const open = (verb) => {
      current = { verb, words: [] };
      out.push(current);
    };

    for (let i = 0; i < words.length; ) {
      const hit = verbAt(words, i);
      if (hit) {
        if (hit.verb === 'place' || hit.verb === 'show') {
          trailing = hit.verb;
        } else if (hit.verb === 'clear') {
          clearFirst = true;
        } else {
          open(hit.verb);
        }
        i += hit.length;
        continue;
      }
      if (words[i] === ',') {
        /* A comma inside a command separates dishes, which understand()
           already handles; kept in place for it. */
        if (current) current.words.push(',');
        i += 1;
        continue;
      }
      if (!current) open('add');
      current.words.push(words[i]);
      i += 1;
    }

    const result = [];
    if (clearFirst) result.push({ verb: 'clear', lines: [] });

    for (const command of out) {
      /* Strip the filler here, AFTER verbs were found: "i want" is a verb and
         "i" is filler, and the verb has to win. */
      const cleaned = command.words
        .filter((w) => w === ',' || !FILLER.has(w))
        .join(' ')
        .replace(/\s+,\s*/g, ', ');
      const lines = understand(cleaned, indexed, search);
      if (lines.length) result.push({ verb: command.verb, lines });
    }

    if (trailing) result.push({ verb: trailing, lines: [] });
    return result;
  }

  return { parse, phrases, quantityOf, understand, matchOne, distance, commands, WORDS, VERBS };
});
