/*
 * Turning speech into text, from whichever provider a shop has chosen.
 *
 * WHERE THE KEY LIVES IS THE WHOLE DESIGN.
 *
 * A paid transcription key put into the app is a key on every waiter's phone,
 * in a file anybody can read, on devices that get lost and sold. It cannot be
 * rotated without reinstalling every handset, and one leaked key is billed to
 * the shop until somebody notices. So a key is never held here. A shop that
 * wants a cloud provider configures it once on the till, and the till does the
 * call: the audio goes to the shop's own server and the key stays on it.
 *
 * That leaves two kinds of provider, and they are chosen for different
 * reasons rather than one being better:
 *
 *   device   the phone's own recognition. Free, private, needs no key, and on
 *            both platforms can work with the internet down once a language
 *            is installed. Weaker on proper nouns, which is most of a menu -
 *            though matching against the shop's own items recovers much of
 *            that (see voice-order.js).
 *
 *   server   the shop's POS relays the audio to whichever provider it is
 *            configured for. Better with accents and noise, costs money per
 *            minute, needs the shop online, and is the only arrangement in
 *            which a key is not sitting in a waiter's pocket.
 *
 * Configuration is read in the order it should win: what this device was told
 * explicitly, then what the shop's server says, then the device's own
 * recogniser. A shop that has configured nothing gets something that works.
 *
 * HELD, NOT TIMED. The waiter presses, speaks for as long as they are
 * speaking, and lets go - the way every voice note anybody has ever sent
 * works. A fixed recording length is the wrong shape for an order: it cuts
 * off the table that wanted one more thing, and it makes the quick "two
 * coffees" wait out a timer for nothing. So a session is begun and ended by a
 * person, and both providers are driven through the same three calls.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Speech = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const STORE = 'posnic.voice';

  const DEFAULTS = {
    provider: 'device',
    /* Indian English by default because that is the estate this serves, and a
       recogniser told the wrong locale mishears numbers before anything
       else. Overridden per shop. */
    language: 'en-IN',
  };

  /* A held button still needs an outer limit. Past this something is wrong -
     a phone in a pocket, a thumb resting on the screen - and a provider
     billed by the minute should not be paid for it. Generous, because a long
     table really does take half a minute to order. */
  const MAX_SECONDS = 45;

  /**
   * What this device should use.
   *
   * @param {object} [fromServer] voice settings the shop's server sent
   */
  function config(fromServer) {
    let local = {};
    try {
      local = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch (e) {
      local = {};
    }
    /* A key must never arrive here, whatever a server sends. Dropped rather
       than trusted, so a misconfigured server cannot put one on a handset. */
    const shop = { ...(fromServer || {}) };
    delete shop.apiKey;
    delete shop.api_key;
    delete shop.secret;

    return { ...DEFAULTS, ...shop, ...local };
  }

  function configure(patch) {
    const next = { ...config(), ...(patch || {}) };
    delete next.apiKey;
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch (e) {
      /* private mode: this session still honours it */
    }
    return next;
  }

  /** The browser or WebView's own recogniser, if it has one. */
  function deviceRecogniser() {
    return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
  }

  const canRecord = () =>
    !!(globalThis.navigator && navigator.mediaDevices && globalThis.MediaRecorder);

  /**
   * Can this device transcribe at all, and how?
   *
   * Asked rather than assumed, so the mic button is absent where it cannot
   * work instead of present and disappointing.
   */
  function available(fromServer) {
    const chosen = config(fromServer).provider;
    if (chosen === 'off') return false;
    if (chosen === 'server') return canRecord(); // the till answers for itself
    return !!deviceRecogniser();
  }

  /*
   * A SESSION is what a held button drives.
   *
   * Three calls, the same for both providers: begun on press, `stop()` on
   * release to get the words, `cancel()` to throw the whole thing away. The
   * caller never learns which provider is behind it, which is the point.
   *
   *   { stop(): Promise<string>, cancel(): void, seconds(): number }
   */

  /** The handset's own recogniser, held open until somebody lets go. */
  function beginOnDevice({ language, onPartial }) {
    const Recogniser = deviceRecogniser();
    if (!Recogniser) throw new Error('This device cannot listen.');

    const recogniser = new Recogniser();
    recogniser.lang = language || DEFAULTS.language;
    /* Interim results so the screen can show words arriving. Several seconds
       of silence while somebody talks reads as a dead button. */
    recogniser.interimResults = true;
    /* Held open across pauses. Without this the recogniser decides for itself
       that the breath between "two chicken biryani" and "and three coffee" is
       the end of the sentence, and half the order is never heard. */
    recogniser.continuous = true;
    recogniser.maxAlternatives = 1;

    let best = '';
    let done = null;
    let failed = null;
    let finished = false;
    let cancelled = false;

    recogniser.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += `${event.results[i][0].transcript} `;
      best = text.trim();
      if (onPartial) onPartial(best);
    };
    recogniser.onerror = (event) => {
      const code = event && event.error;
      /* Not an error while somebody is still holding the button: they have
         simply not started talking yet. Only a refusal ends the session. */
      if (code === 'no-speech' || code === 'aborted') return;
      failed = new Error(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'The microphone is blocked for this app. Allow it in Settings.'
          : 'Could not listen just now.'
      );
      if (done) done();
    };
    recogniser.onend = () => {
      finished = true;
      if (done) done();
    };

    try {
      recogniser.start();
    } catch (e) {
      throw new Error('Could not start listening.');
    }

    const startedAt = Date.now();

    return {
      seconds: () => (Date.now() - startedAt) / 1000,
      cancel() {
        cancelled = true;
        try {
          if (recogniser.abort) recogniser.abort();
          else recogniser.stop();
        } catch (e) {
          /* already stopped */
        }
      },
      stop() {
        return new Promise((resolve, reject) => {
          const settle = () => {
            done = null;
            if (failed) return reject(failed);
            resolve(cancelled ? '' : best);
          };
          if (finished) return settle();
          done = settle;
          try {
            recogniser.stop();
          } catch (e) {
            settle();
          }
          /* A recogniser that never fires onend must not hang the button
             with a waiter standing at a table waiting for it. */
          setTimeout(() => {
            if (done) settle();
          }, 4000);
        });
      },
    };
  }

  /**
   * Record until released, then let the shop's own server transcribe it.
   *
   * One call to the POS. The provider and its key live there; this never
   * learns which was used, which is the point.
   */
  function beginOnServer({ language, onLevel }) {
    if (!canRecord()) throw new Error('This device cannot record.');

    const startedAt = Date.now();
    let recorder = null;
    let stream = null;
    let cancelled = false;
    const chunks = [];

    /*
     * Opening the microphone is asynchronous and the button is already down.
     * The promise is kept so stop() can WAIT for it rather than race it: a
     * waiter who says two words and releases would otherwise be stopping a
     * recorder that had not started, and the order would be silence.
     */
    const opening = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((granted) => {
        stream = granted;
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.start();
        if (onLevel) meter(stream, onLevel, () => cancelled || !recorder);
        return recorder;
      })
      .catch(() => {
        throw new Error('The microphone is blocked for this app. Allow it in Settings.');
      });

    const release = () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };

    return {
      seconds: () => (Date.now() - startedAt) / 1000,
      cancel() {
        cancelled = true;
        try {
          if (recorder && recorder.state !== 'inactive') recorder.stop();
        } catch (e) {
          /* already stopped */
        }
        release();
      },
      async stop() {
        await opening;
        if (cancelled || !recorder) {
          release();
          return '';
        }

        const blob = await new Promise((resolve) => {
          recorder.onstop = () =>
            resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
          try {
            if (recorder.state !== 'inactive') recorder.stop();
            else recorder.onstop();
          } catch (e) {
            resolve(new Blob(chunks, { type: 'audio/webm' }));
          }
        });
        release();
        if (!blob.size) return '';

        const audio = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Could not read the recording.'));
          reader.readAsDataURL(blob);
        });

        if (typeof POSNIC === 'undefined' || !POSNIC.api) {
          throw new Error('No server to transcribe with.');
        }
        const result = await POSNIC.api.post('/sales/transcribe', {
          audio,
          language,
          mimeType: blob.type,
        });
        return String((result && (result.text || (result.data && result.data.text))) || '').trim();
      },
    };
  }

  /**
   * How loud it is right now, for a bar that proves the microphone is live.
   *
   * A recording screen that does not move is one a waiter presses again
   * halfway through, losing the first half of the order.
   */
  function meter(stream, onLevel, stopped) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    try {
      const context = new Ctx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (stopped()) {
          try {
            context.close();
          } catch (e) {
            /* already closed */
          }
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += (data[i] - 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / data.length) / 40));
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      /* a level bar is a nicety; its absence must not stop a recording */
    }
  }

  /**
   * Begin listening. The caller decides when it ends.
   *
   * @param {object} options
   * @param {(text: string) => void} [options.onPartial] words as they arrive
   * @param {(level: number) => void} [options.onLevel] 0..1 loudness
   * @returns {{stop: () => Promise<string>, cancel: () => void, seconds: () => number}}
   */
  function start(options = {}) {
    const settings = config(options.fromServer);
    if (settings.provider === 'off') throw new Error('Voice ordering is turned off for this shop.');
    const shared = { language: settings.language, ...options };
    return settings.provider === 'server' ? beginOnServer(shared) : beginOnDevice(shared);
  }

  /**
   * Listen for a fixed stretch and resolve with what was said.
   *
   * Kept for a caller with nothing to hold - a hands-free screen, a test. The
   * handset's button uses start() instead, because a person deciding they
   * have finished speaking beats any timer.
   */
  async function listen(options = {}) {
    const session = start(options);
    await new Promise((resolve) => {
      setTimeout(resolve, (options.seconds || 8) * 1000);
    });
    return session.stop();
  }

  return {
    DEFAULTS,
    STORE,
    MAX_SECONDS,
    config,
    configure,
    available,
    start,
    listen,
    deviceRecogniser,
    canRecord,
  };
});
