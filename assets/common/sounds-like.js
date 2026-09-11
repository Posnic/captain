/*
 * What a word SOUNDS like, for a menu spoken in Indian English.
 *
 * WHY NOT SOUNDEX OR METAPHONE. Both were built for English surnames in
 * American census records. They fold the confusions an American clerk makes
 * and keep the ones that matter here: Soundex puts "paneer" and "panner" in
 * different buckets, and separates "dosa" from "thosai", which are the same
 * word written by two people. Running an algorithm tuned for Massachusetts
 * over a Tamil Nadu menu is worse than running nothing, because it looks like
 * it works.
 *
 * WHAT ACTUALLY GOES WRONG HERE. A recogniser trained on English transcribes
 * Indian food words by ear, and the same dish comes back a dozen ways:
 *
 *   biryani / biriyani / briyani / bryani / biriani
 *   paneer / panner / paner / panir
 *   dosa / dosai / thosai / dhosa
 *   parotta / porotta / barotta
 *   vada / wada / vadai
 *   gobi / gopi / gobhi
 *
 * Every one of those is the same handful of substitutions:
 *
 *   - ASPIRATION IS SPELLING, NOT SOUND. th/t, dh/d, bh/b, kh/k, ph/f are one
 *     sound each to the speaker. A transcript picks whichever it likes.
 *   - VOICING SLIDES. p/b, t/d, k/g, s/z - Tamil has no voicing contrast in
 *     the same places English does, so a recogniser guesses and guesses badly.
 *   - v AND w ARE ONE LETTER. "vada" and "wada" are not two words.
 *   - VOWELS ARE NOISE. They carry almost nothing in a dish name and they are
 *     where a recogniser errs most: biryani, biriyani and bryani differ only
 *     in vowels and are the same order.
 *   - DOUBLED LETTERS ARE A WRITING CHOICE. panner, paneer, paner.
 *
 * So the key is a consonant skeleton with those classes folded together. It is
 * deliberately coarse. It is the LAST thing tried, after exact and prefix
 * matching have failed, and anything it finds is shown to the waiter to
 * confirm rather than added silently - so a wrong guess costs a tap, and a
 * right one saves an order.
 *
 * WHAT IS DELIBERATELY KEPT APART. l and r stay different, and m and n stay
 * different: folding those would put "rice" and "lice" in one bucket for no
 * gain, because they are not the confusions that actually happen.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SoundsLike = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /*
   * Consonants that a listener here cannot reliably tell apart, one letter per
   * class. The letter chosen to stand for a class is arbitrary; only the
   * grouping matters.
   */
  const CLASS = {
    /* Voicing, and v/w, which are one letter to the speaker. */
    b: 'B', p: 'B', v: 'B', w: 'B',
    /*
     * f STANDS ALONE, and this was a real bug rather than a nicety.
     *
     * Folding f in with p and b - which is defensible, since Tamil has no f
     * and "coffee" is said "kaapi" - put "coffee" and "gobi" in the same
     * bucket, both KB. A waiter asking for a coffee and being offered Gobi
     * Manchurian is exactly the kind of confident wrong answer this whole file
     * exists to avoid.
     *
     * The trade is that "copy" no longer reaches "coffee". That is the right
     * way round: a wrong item on a bill costs an argument at a table, and a
     * missed match costs saying it again.
     */
    f: 'F',
    c: 'K', k: 'K', g: 'K', q: 'K',
    d: 'T', t: 'T',
    s: 'S', z: 'S', j: 'S', x: 'S',
    m: 'M',
    n: 'N',
    l: 'L',
    r: 'R',
    h: '',
    y: '',
  };

  /*
   * The shortest key worth trusting.
   *
   * A one-sound key is most of the dictionary. "tea" and "toe" both reduce to
   * T, and a word that short has already been caught by exact or prefix
   * matching before anything here is reached.
   */
  const ENOUGH = 2;

  const VOWELS = 'aeiou';

  /**
   * The sound of one word.
   *
   * Returns '' for anything with no consonants in it, which the callers treat
   * as "no opinion" rather than as a match - otherwise every vowel-only noise
   * a recogniser emits would match every other one.
   */
  function key(word) {
    const letters = String(word || '')
      .toLowerCase()
      .normalize('NFD')
      /* Accents off: a transcript may or may not carry them and they never
         distinguish two dishes on the same menu. */
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]/g, '');

    if (!letters) return '';

    /*
     * Digraphs first, before any letter is classed on its own.
     *
     * "sh" and "ch" are single sounds, and both slide towards s here -
     * "chapati" and "shapati" are the same order. Doing this after the
     * per-letter pass would turn "ch" into two consonants and make every word
     * containing it a syllable too long.
     */
    const sounds = letters
      /*
       * Soft c and soft g, before anything else classes them as K.
       *
       * "rice" came out RK, which is not a sound anybody makes, and it put
       * rice next to nothing and away from everything. Same for "juice" and
       * "ginger".
       */
      .replace(/c(?=[eiy])/g, 's')
      .replace(/g(?=[eiy])/g, 'j')
      .replace(/sch/g, 's')
      .replace(/[cs]h/g, 's')
      .replace(/zh/g, 's')
      .replace(/ck/g, 'k')
      .replace(/qu/g, 'k')
      /* Aspiration is spelling, not sound. */
      .replace(/ph/g, 'f')
      .replace(/gh/g, 'g')
      .replace(/kh/g, 'k')
      .replace(/bh/g, 'b')
      .replace(/dh/g, 'd')
      .replace(/th/g, 't')
      .replace(/jh/g, 'j');

    /*
     * A word that STARTS with a vowel is marked, because that is a real
     * difference somebody hears: "idli" and "dal" are not near each other, and
     * dropping the leading vowel would put them one letter apart.
     */
    let out = VOWELS.includes(sounds[0]) ? 'A' : '';
    let last = '';

    for (const letter of sounds) {
      if (VOWELS.includes(letter)) continue;
      const sound = CLASS[letter];
      if (!sound) continue;
      /* Doubled letters are a writing choice: paneer, panner, paner. */
      if (sound === last) continue;
      out += sound;
      last = sound;
    }

    /* Consonants are what carries a dish name. A "word" with none of them is
       a recogniser clearing its throat. */
    return out === 'A' ? '' : out;
  }

  /**
   * Whether two words would be heard as the same word.
   *
   * Short keys are required to match exactly. A two-sound key like "KB" covers
   * an enormous number of words, so allowing any slack there matches
   * everything; a longer key has earned the right to be forgiven a sound.
   */
  function alike(a, b) {
    const left = key(a);
    const right = key(b);
    if (left.length < ENOUGH || right.length < ENOUGH) return false;
    return left === right;
  }

  /**
   * How well one spoken phrase sounds like a dish name, 0 to 1.
   *
   * Word by word rather than as one run of sounds. A recogniser gets ONE word
   * of a name wrong, not all of it, and comparing whole names lets a long name
   * absorb a wrong word - "chicken biryani" would match "mutton biryani" on
   * the strength of the half that is right, which is the one mistake nobody
   * would forgive at a table.
   *
   * Scored against the number of words SAID, so hearing "biryani" against
   * "Chicken Biryani" is a partial match rather than a miss, while hearing
   * "chicken biryani" against "Chicken Biryani Family Pack" is still 1.
   */
  function score(said, name) {
    const spoken = words(said);
    const target = words(name);
    if (!spoken.length || !target.length) return 0;

    const pool = target.slice();
    let hit = 0;

    for (const one of spoken) {
      const at = pool.indexOf(one);
      if (at === -1) continue;
      pool.splice(at, 1);
      hit += 1;
    }

    return hit / spoken.length;
  }

  /** Every word of a phrase, as sounds, with the meaningless ones dropped. */
  function words(text) {
    /*
     * EVERY REAL WORD IS KEPT, even one that reduces to a single sound.
     *
     * These were filtered by length once, and it quietly broke the guarantee
     * the callers depend on: "zzzz briyani" reduces to ["S", "BRN"], the "S"
     * was dropped as too short, and the phrase then matched Chicken Biryani as
     * though the waiter had only said "briyani". A word the caller must
     * account for cannot be one this function has thrown away.
     *
     * Only genuinely empty keys go - a vowel on its own, punctuation, a
     * recogniser clearing its throat. Whether a phrase has enough substance to
     * be matched at ALL is a separate question, and the caller asks it with
     * ENOUGH.
     */
    return String(text || '')
      .split(/[^A-Za-z0-9]+/)
      .map(key)
      .filter(Boolean);
  }

  return { key, alike, score, words, ENOUGH };
});
