/* global AudioWorkletProcessor, registerProcessor, currentFrame, SoundTouch */
/**
 * The tempo/pitch stretcher as an AudioWorklet: the same SoundTouch WSOLA code the app used before (SoundTouchJS,
 * LGPL), but running on the audio rendering thread instead of a main-thread ScriptProcessorNode.
 *
 * Why: the ScriptProcessor version needs the main thread to deliver an event for every 1024 frames (21 ms), and the
 * browser delivers them late whenever the page is busy; each late delivery is a zero-filled gap in the output. Measured
 * on the real player during a morph, with the stretcher's own callbacks taking 2 ms at most: 17 callbacks arrived more
 * than 1.6x late, the worst after 49 ms, and each lined up with a hole in the output (plus a 12-50 ms hole at the swap).
 * Here nothing depends on the main thread once the audio has been handed over.
 *
 * This file is NOT loaded as-is: scripts/build-stretch-worklet.mjs prepends the SoundTouchJS source (which supplies the
 * SoundTouch global) and writes public/worklets/time-stretch.js, the file the browser loads.
 *
 * Work per audio block is bounded: input is fed to the stretcher FEED_FRAMES at a time and only as far as one 128-frame
 * block needs, never in one big batch the way SoundTouchJS's own SimpleFilter does (16384 frames at once). The stretcher
 * itself releases audio in bursts of about one analysis window, so a block can still consume 4-5k frames at once in the
 * steady state; the start-up work (several thousand frames before the first sample) is what the scheduled start lets
 * the processor spread over silent blocks (see prime()).
 *
 * Messages in:  { type: "load", left, right, baseFrame, startFrame, atFrame, exact }   the audio to play (transferred),
 *                   the absolute source frame its first sample is, the absolute source frame the FIRST AUDIBLE sample
 *                   must be, the context frame to begin output at (0 = at once), and whether to play it untouched
 *                   (`exact`: no stretching at all, for a voice that will only ever be at tempo 1 and pitch 0 — the
 *                   audio comes out sample for sample, with no WSOLA smearing or timing jitter, and tempo/pitch
 *                   messages are ignored)
 *               { type: "tempo", value } / { type: "pitch", semitones } / { type: "stop" }
 * Messages out: { type: "pos", sourceFrame, atFrame }  every POSITION_EVERY blocks: how far into the source the
 *                   audio being output now is, and the context frame that was true at
 *               { type: "ended" }                      once the source has been played out
 */

const FEED_FRAMES = 512;
const POSITION_EVERY = 4;
const QUANTUM = 128;
/** Before a scheduled start the stretcher is primed, one FEED_FRAMES chunk per silent block, until this much output is ready. */
const PRIME_FRAMES = 2048;
/**
 * How far the pipeline's own bookkeeping (audibleSourceFrame) sits from the audio really being heard, in FRAMES (the
 * stretch stage's windows are fixed at 44.1 kHz-sized frame counts whatever the context's sample rate), fitted by least
 * squares over a grid of tempos (0.8-1.25) and pitch shifts (-4..+4 semitones) against a ramp source whose every sample's
 * value is its own position (time-stretch-processor.test.ts re-measures it): error = BASE + TEMPO*(t-1) + PITCH*p +
 * BOTH*(t-1)*p, where the error is reported minus heard. It comes from the stretch stage's internal overlap.
 */
const POSITION_ERROR_FRAMES = { base: -843, tempo: 2491, pitch: -158.8, both: -18.6 };
/**
 * The stretcher hands audio out in bursts, so the raw bookkeeping saws up and down by up to +-17 ms when its stretch
 * stage is far from 1x. The heard position really advances by `tempo` source frames per output frame, so the reported
 * position is predicted forward by that each block and pulled toward each fresh measurement by this fraction.
 */
const POSITION_SMOOTHING = 0.012;
/**
 * The stretcher's first window skips ahead: asked to start at frame S, its first steady output is the audio at S + skip
 * frames. The skip does not depend on the music (exactly 1364 frames with no spread over 200 start points at tempo 1,
 * pitch 0; the old hand-tuned SONG_SYNC_START_LEAD_SEC of 0.027 s was this number) but does on the tempo and pitch the
 * stretcher is set to, measured over the same grid as above and fitted as a quadratic in tempo and pitch (largest
 * miss 84 frames, under 2 ms). Feeding that much earlier makes the first audible sample the one that was asked for.
 */
const INITIAL_SKIP_FIT = [1342.714, -2413.14, 169.054, 328.77, 24.123, -6.362]; // 1, t-1, p, (t-1)^2, (t-1)p, p^2

class TimeStretchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.st = new SoundTouch();
    this.left = null;
    this.right = null;
    this.length = 0;
    this.baseFrame = 0;
    this.readPos = 0;
    this.atFrame = 0;
    this.feed = new Float32Array(FEED_FRAMES * 2);
    this.block = new Float32Array(QUANTUM * 2);
    this.blocks = 0;
    this.pitchSemitones = 0;
    this.exact = false;
    this.estimate = null;
    this.ended = false;
    this.stopped = false;
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(message) {
    switch (message.type) {
      case "load":
        this.st.clear();
        this.left = message.left;
        this.right = message.right || message.left;
        this.length = this.left.length;
        this.baseFrame = message.baseFrame || 0;
        // Begin reading the stretcher's initial skip before the wanted start (as far back as the loaded audio goes).
        this.readPos = Math.max(0, (message.startFrame ?? this.baseFrame) - this.baseFrame - this.initialSkipFrames());
        this.atFrame = message.atFrame || 0;
        this.estimate = null;
        this.ended = false;
        this.exact = !!message.exact;
        if (this.exact) this.readPos = Math.max(0, (message.startFrame ?? this.baseFrame) - this.baseFrame); // no skip to make up
        // No work here: this handler runs on the same thread that renders every other sound in the page, so the
        // stretcher's start-up work is spread over the silent blocks before the start instead (see prime()).
        break;
      case "tempo":
        if (!this.exact) this.st.tempo = message.value;
        break;
      case "pitch":
        if (!this.exact) {
          this.pitchSemitones = message.semitones;
          this.st.pitchSemitones = message.semitones;
        }
        break;
      case "stop":
        this.stopped = true;
        this.left = null;
        this.right = null;
        break;
      default:
        break;
    }
  }

  /** Frames the stretcher's first output sits ahead of where it was told to start, at its current tempo and pitch (see INITIAL_SKIP_FIT). */
  initialSkipFrames() {
    const t = this.st.virtualTempo - 1;
    const p = this.pitchSemitones;
    const c = INITIAL_SKIP_FIT;
    const skip = c[0] + c[1] * t + c[2] * p + c[3] * t * t + c[4] * t * p + c[5] * p * p;
    return Math.round(Math.max(0, Math.min(4000, skip)));
  }

  /** Feeds the stretcher one chunk (up to FEED_FRAMES) of the source and lets it process what it has. */
  feedChunk() {
    const n = Math.min(FEED_FRAMES, this.length - this.readPos);
    const feed = this.feed;
    for (let i = 0; i < n; i++) {
      feed[i * 2] = this.left[this.readPos + i];
      feed[i * 2 + 1] = this.right[this.readPos + i];
    }
    this.readPos += n;
    this.st.inputBuffer.putSamples(feed, 0, n);
    this.st.process();
  }

  /** One bounded step of start-up work: the stretcher needs several thousand frames of input before its first output. */
  prime() {
    if (this.st.outputBuffer.frameCount < PRIME_FRAMES && this.readPos < this.length) this.feedChunk();
  }

  /** Feeds the stretcher until `frames` of output are ready (or the source has run out). */
  fill(frames) {
    while (this.st.outputBuffer.frameCount < frames && this.readPos < this.length) this.feedChunk();
  }

  /**
   * The source frame the audio leaving the output right now came from. The stretcher runs ahead of playback, so what has
   * been READ from the source is not what is HEARD: subtract what is still waiting in front of it (input not yet
   * processed, the transposer's output waiting for the stretch stage, converted back to source frames by the rate) and
   * what is already stretched but not yet played (output frames, which each cover `tempo` source frames), then remove
   * the fitted error of the stretch stage's own overlap.
   */
  audibleSourceFrame() {
    const st = this.st;
    const waiting =
      st.inputBuffer.frameCount + st._intermediateBuffer.frameCount * st._rate + st.outputBuffer.frameCount * st.virtualTempo;
    const t = st.virtualTempo - 1;
    const p = this.pitchSemitones;
    const e = POSITION_ERROR_FRAMES;
    const error = e.base + e.tempo * t + e.pitch * p + e.both * t * p;
    return this.baseFrame + this.readPos - waiting - error;
  }

  /** The smoothed heard position (see POSITION_SMOOTHING), advanced by one block of `take` output frames. */
  updateEstimate(take) {
    const measured = this.audibleSourceFrame();
    if (this.estimate === null) {
      this.estimate = measured;
    } else {
      this.estimate += take * this.st.virtualTempo;
      this.estimate += (measured - this.estimate) * POSITION_SMOOTHING;
    }
  }

  /** Untouched playback: the source, sample for sample, from where it was told to start. */
  processExact(outL, outR) {
    // A scheduled start can fall inside this block: leave the samples before it silent and begin on the exact frame.
    const lead = Math.max(0, this.atFrame - currentFrame);
    if (lead >= QUANTUM) return true;
    const room = QUANTUM - lead;
    const take = Math.min(room, Math.max(0, this.length - this.readPos));
    for (let i = 0; i < take; i++) {
      outL[lead + i] = this.left[this.readPos + i];
      outR[lead + i] = this.right[this.readPos + i];
    }
    const blockStart = this.baseFrame + this.readPos - lead; // the source frame the first sample of this block stands for
    this.readPos += take;
    if (++this.blocks % POSITION_EVERY === 0) {
      this.port.postMessage({ type: "pos", sourceFrame: blockStart, atFrame: currentFrame });
    }
    if (take < room && !this.ended) {
      this.ended = true;
      this.port.postMessage({ type: "ended" });
    }
    return !this.ended;
  }

  process(inputs, outputs) {
    if (this.stopped) return false;
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!this.left) return true; // nothing loaded yet: the block stays silent
    if (this.exact) return this.processExact(outL, outR);
    // A scheduled start can fall inside this block: the samples before it stay silent and the audio begins on that frame.
    const lead = Math.max(0, this.atFrame - currentFrame);
    if (lead >= QUANTUM) {
      this.prime(); // waiting for the scheduled start: get ready, silently, a chunk at a time
      return true;
    }

    this.fill(QUANTUM - lead);
    const out = this.st.outputBuffer;
    const take = Math.min(QUANTUM - lead, out.frameCount);
    if (take > 0) {
      out.extract(this.block, 0, take);
      out.receive(take);
      for (let i = 0; i < take; i++) {
        outL[lead + i] = this.block[i * 2];
        outR[lead + i] = this.block[i * 2 + 1];
      }
    }
    if (take > 0) this.updateEstimate(take);
    if (take === 0 && this.readPos >= this.length && !this.ended) {
      this.ended = true;
      this.port.postMessage({ type: "ended" });
    }
    if (++this.blocks % POSITION_EVERY === 0) {
      if (this.estimate !== null) this.port.postMessage({ type: "pos", sourceFrame: this.estimate, atFrame: currentFrame });
    }
    return !this.ended;
  }
}

registerProcessor("time-stretch", TimeStretchProcessor);
