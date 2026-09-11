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
    return (
      globalThis.SpeechRecognition ||
      globalThis.webkitSpeechRecognition ||
      null
    );
  }

  /**
   * Can this device transcribe at all, and how?
   *
   * Asked rather than assumed, so the mic button is absent where it cannot
   * work instead of present and disappointing.
   */
  function available(fromServer) {
    const chosen = config(fromServer).provider;
    if (chosen === 'off') return false;
    if (chosen === 'server') return true; // the till answers for itself
    return !!deviceRecogniser();
  }

  /**
   * Listen once, and resolve with what was said.
   *
   * @param {object} options
   * @param {(text: string) => void} [options.onPartial] interim words, for a
   *   screen that shows speech as it arrives
   * @returns {Promise<string>}
   */
  function listenOnDevice({ language, onPartial } = {}) {
    return new Promise((resolve, reject) => {
      const Recogniser = deviceRecogniser();
      if (!Recogniser) return reject(new Error('This device cannot listen.'));

      const recogniser = new Recogniser();
      recogniser.lang = language || DEFAULTS.language;
      /* Interim results so the screen can show words arriving. Silence for
         several seconds while somebody talks reads as a dead button. */
      recogniser.interimResults = true;
      recogniser.continuous = false;
      recogniser.maxAlternatives = 1;

      let best = '';
      recogniser.onresult = (event) => {
        let text = '';
        for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + ' ';
        best = text.trim();
        if (onPartial) onPartial(best);
      };
      recogniser.onerror = (event) => {
        const code = event && event.error;
        reject(new Error(
          code === 'not-allowed'
            ? 'The microphone is blocked for this app. Allow it in Settings.'
            : code === 'no-speech'
              ? 'Nothing was heard. Try again, closer to the phone.'
              : 'Could not listen just now.'
        ));
      };
      recogniser.onend = () => resolve(best);

      try {
        recogniser.start();
      } catch (e) {
        reject(new Error('Could not start listening.'));
      }
      globalThis.__posnicRecogniser = recogniser;
    });
  }

  function stop() {
    try {
      if (globalThis.__posnicRecogniser) globalThis.__posnicRecogniser.stop();
    } catch (e) {
      /* already stopped */
    }
  }

  /**
   * Listen, using whatever this shop is configured for.
   *
   * The server path is deliberately a single call to the shop's own POS. The
   * provider and its key live there; this never learns which was used, which
   * is the point.
   */
  async function listen(options = {}) {
    const settings = config(options.fromServer);
    if (settings.provider === 'off') throw new Error('Voice ordering is turned off for this shop.');

    if (settings.provider === 'server') {
      if (!POSNIC || !POSNIC.api) throw new Error('No server to transcribe with.');
      const audio = await recordClip(options);
      const result = await POSNIC.api.post('/sales/transcribe', {
        audio,
        language: settings.language,
      });
      return String((result && (result.text || (result.data && result.data.text))) || '').trim();
    }

    return listenOnDevice({ language: settings.language, onPartial: options.onPartial });
  }

  /**
   * Record a short clip for a server that will transcribe it.
   *
   * Capped hard. An order is a sentence; anything longer is a phone left in a
   * pocket, and a provider billed by the minute should not be paid for that.
   */
  function recordClip({ seconds = 12 } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.mediaDevices || !globalThis.MediaRecorder) {
        return reject(new Error('This device cannot record.'));
      }
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const chunks = [];
          const recorder = new MediaRecorder(stream);
          const finish = () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = () => reject(new Error('Could not read the recording.'));
            reader.readAsDataURL(blob);
          };
          recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
          recorder.onstop = finish;
          recorder.start();
          globalThis.__posnicRecorder = recorder;
          setTimeout(() => {
            if (recorder.state !== 'inactive') recorder.stop();
          }, seconds * 1000);
        })
        .catch(() =>
          reject(new Error('The microphone is blocked for this app. Allow it in Settings.'))
        );
    });
  }

  function stopRecording() {
    try {
      const recorder = globalThis.__posnicRecorder;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch (e) {
      /* already stopped */
    }
  }

  return {
    DEFAULTS, STORE,
    config, configure, available, listen, stop, stopRecording,
    deviceRecogniser, listenOnDevice, recordClip,
  };
});
