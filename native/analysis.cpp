// C++/WebAssembly port of src/lib/audio-analysis.ts's DSP core (tempo,
// beat grid, energy-onset/breakdown/drop, waveform peaks, key estimation).
//
// This mirrors that file's algorithms function-for-function so the two
// stay in sync by inspection. It exists purely for speed — the TypeScript
// version in audio-analysis.ts remains the tested reference implementation
// and universal fallback (used by every unit test, and whenever this WASM
// module fails to load); this file is never the only implementation of
// the analysis logic.
//
// Rebuild after editing with `npm run build:wasm` (requires an activated
// Emscripten SDK — see scripts/build-wasm.sh).

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <vector>

using emscripten::val;

namespace {

constexpr double MIN_BPM = 60.0;
constexpr double MAX_BPM = 200.0;
constexpr double ENVELOPE_HOP_SEC = 0.01;
constexpr double FALLBACK_BPM = 120.0;
constexpr double MIN_TEMPO_CONFIDENCE = 0.15;

const char* const PITCH_CLASSES[12] = {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

const double MAJOR_PROFILE[12] = {6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                                   2.52, 5.19, 2.39, 3.66, 2.29, 2.88};
const double MINOR_PROFILE[12] = {6.33, 2.68, 3.52, 5.38, 2.6,  3.53,
                                   2.54, 4.75, 3.98, 2.69, 3.34, 3.17};
const int MAJOR_CAMELOT_NUMBER_BY_SEMITONE[12] = {8, 3, 10, 5, 12, 7,
                                                    2, 9, 4,  11, 6, 1};

std::vector<float> computeEnergyEnvelope(const std::vector<float>& samples,
                                          double sampleRate,
                                          double hopSec = ENVELOPE_HOP_SEC) {
  int hopSize = std::max(1, static_cast<int>(std::round(sampleRate * hopSec)));
  int windowSize = hopSize * 2;
  int numWindows = std::max(1, static_cast<int>(samples.size()) / hopSize);
  std::vector<float> envelope(numWindows);
  for (int w = 0; w < numWindows; w++) {
    int start = w * hopSize;
    int end = std::min(static_cast<int>(samples.size()), start + windowSize);
    double sumSquares = 0;
    for (int i = start; i < end; i++) sumSquares += static_cast<double>(samples[i]) * samples[i];
    envelope[w] = static_cast<float>(std::sqrt(sumSquares / std::max(1, end - start)));
  }
  return envelope;
}

std::vector<float> computeOnsetEnvelope(const std::vector<float>& envelope) {
  std::vector<float> onset(envelope.size(), 0.0f);
  for (size_t i = 1; i < envelope.size(); i++) {
    onset[i] = std::max(0.0f, envelope[i] - envelope[i - 1]);
  }
  return onset;
}

bool isHarmonicallyRelated(double lag, double referenceLag, double tolerance = 0.03) {
  for (int k = 1; k <= 4; k++) {
    if (std::abs(lag / (referenceLag * k) - 1) <= tolerance) return true;
    if (std::abs(referenceLag / (lag * k) - 1) <= tolerance) return true;
  }
  return false;
}

struct TempoEstimate {
  double bpm;
  double confidence;
};

TempoEstimate estimateTempo(const std::vector<float>& onsetEnvelope, double envelopeRateHz) {
  int minLag = static_cast<int>(std::floor((60 / MAX_BPM) * envelopeRateHz));
  int maxLag = static_cast<int>(std::ceil((60 / MIN_BPM) * envelopeRateHz));
  if (static_cast<int>(onsetEnvelope.size()) < maxLag * 2) {
    return {FALLBACK_BPM, 0.0};
  }

  std::vector<double> scoresByLag(maxLag + 1, 0.0);
  for (int lag = minLag; lag <= maxLag; lag++) {
    double sum = 0;
    int count = 0;
    for (int i = lag; i < static_cast<int>(onsetEnvelope.size()); i++) {
      sum += static_cast<double>(onsetEnvelope[i]) * onsetEnvelope[i - lag];
      count++;
    }
    scoresByLag[lag] = count > 0 ? sum / count : 0;
  }

  int bestLag = minLag;
  double bestScore = -std::numeric_limits<double>::infinity();
  for (int lag = minLag; lag <= maxLag; lag++) {
    if (scoresByLag[lag] > bestScore) {
      bestScore = scoresByLag[lag];
      bestLag = lag;
    }
  }

  double secondBestScore = 0;
  for (int lag = minLag; lag <= maxLag; lag++) {
    if (lag == bestLag) continue;
    if (isHarmonicallyRelated(lag, bestLag)) continue;
    if (scoresByLag[lag] > secondBestScore) secondBestScore = scoresByLag[lag];
  }

  double bpm = (60 * envelopeRateHz) / bestLag;
  double confidence = bestScore > 0
                           ? std::max(0.0, std::min(1.0, 1 - secondBestScore / bestScore))
                           : 0.0;
  return {bpm, confidence};
}

double findBeatGridOffset(const std::vector<float>& onsetEnvelope, double envelopeRateHz,
                           double thresholdRatio = 0.5) {
  float maxVal = 0;
  for (float v : onsetEnvelope) maxVal = std::max(maxVal, v);
  if (maxVal <= 0) return 0;
  float threshold = static_cast<float>(maxVal * thresholdRatio);
  for (size_t i = 0; i < onsetEnvelope.size(); i++) {
    if (onsetEnvelope[i] >= threshold) return i / envelopeRateHz;
  }
  return 0;
}

std::vector<float> smoothEnvelope(const std::vector<float>& envelope, int windowSize) {
  std::vector<float> smoothed(envelope.size());
  for (int i = 0; i < static_cast<int>(envelope.size()); i++) {
    int start = std::max(0, i - windowSize + 1);
    double sum = 0;
    for (int j = start; j <= i; j++) sum += envelope[j];
    smoothed[i] = static_cast<float>(sum / (i - start + 1));
  }
  return smoothed;
}

double percentile75(const std::vector<float>& smoothed) {
  std::vector<float> sorted(smoothed);
  std::sort(sorted.begin(), sorted.end());
  if (sorted.empty()) return 0;
  size_t idx = static_cast<size_t>(std::floor(sorted.size() * 0.75));
  if (idx >= sorted.size()) idx = sorted.size() - 1;
  return sorted[idx];
}

double findEnergyOnset(const std::vector<float>& envelope, double envelopeRateHz) {
  if (envelope.empty()) return 0;
  int smoothWindow = std::max(1, static_cast<int>(std::round(envelopeRateHz * 1)));
  auto smoothed = smoothEnvelope(envelope, smoothWindow);

  double loudLevel = percentile75(smoothed);
  if (loudLevel <= 0) return 0;

  int sustainWindow = std::max(1, static_cast<int>(std::round(envelopeRateHz * 2)));
  for (int i = 0; i < static_cast<int>(smoothed.size()); i++) {
    if (smoothed[i] < loudLevel * 0.6) continue;
    int end = std::min(static_cast<int>(smoothed.size()), i + sustainWindow);
    double sustainSum = 0;
    for (int j = i; j < end; j++) sustainSum += smoothed[j];
    double sustainAvg = sustainSum / std::max(1, end - i);
    if (sustainAvg >= loudLevel * 0.4) return i / envelopeRateHz;
  }
  return 0;
}

double findEnergyPeak(const std::vector<float>& envelope, double envelopeRateHz, bool& found) {
  found = false;
  if (envelope.empty()) return 0;
  int smoothWindow = std::max(1, static_cast<int>(std::round(envelopeRateHz * 1)));
  auto smoothed = smoothEnvelope(envelope, smoothWindow);
  int bestIdx = 0;
  double bestVal = -std::numeric_limits<double>::infinity();
  for (int i = 0; i < static_cast<int>(smoothed.size()); i++) {
    if (smoothed[i] > bestVal) {
      bestVal = smoothed[i];
      bestIdx = i;
    }
  }
  if (bestVal <= 0) return 0;
  found = true;
  return bestIdx / envelopeRateHz;
}

double findBreakdown(const std::vector<float>& envelope, double envelopeRateHz, double afterSec,
                      bool& found) {
  found = false;
  if (envelope.empty()) return 0;
  int smoothWindow = std::max(1, static_cast<int>(std::round(envelopeRateHz * 1)));
  auto smoothed = smoothEnvelope(envelope, smoothWindow);
  double loudLevel = percentile75(smoothed);
  if (loudLevel <= 0) return 0;

  int startIdx = std::max(0, static_cast<int>(std::round(afterSec * envelopeRateHz)));
  int sustainWindow = std::max(1, static_cast<int>(std::round(envelopeRateHz * 2)));
  for (int i = startIdx; i < static_cast<int>(smoothed.size()); i++) {
    if (smoothed[i] > loudLevel * 0.35) continue;
    int end = std::min(static_cast<int>(smoothed.size()), i + sustainWindow);
    double sustainSum = 0;
    for (int j = i; j < end; j++) sustainSum += smoothed[j];
    double sustainAvg = sustainSum / std::max(1, end - i);
    if (sustainAvg <= loudLevel * 0.35) {
      found = true;
      return i / envelopeRateHz;
    }
  }
  return 0;
}

std::vector<float> downsampleForWaveform(const std::vector<float>& envelope, int points = 240) {
  std::vector<float> peaks(points, 0.0f);
  if (envelope.empty()) return peaks;
  double chunkSize = static_cast<double>(envelope.size()) / points;
  float maxVal = 0;
  for (int p = 0; p < points; p++) {
    int start = static_cast<int>(std::floor(p * chunkSize));
    int end = std::max(start + 1, static_cast<int>(std::floor((p + 1) * chunkSize)));
    float peak = 0;
    for (int i = start; i < end && i < static_cast<int>(envelope.size()); i++) {
      if (envelope[i] > peak) peak = envelope[i];
    }
    peaks[p] = peak;
    if (peak > maxVal) maxVal = peak;
  }
  if (maxVal > 0) {
    for (int p = 0; p < points; p++) peaks[p] /= maxVal;
  }
  return peaks;
}

int nextPowerOfTwo(int n) {
  int p = 1;
  while (p < n) p *= 2;
  return p;
}

/** In-place iterative radix-2 Cooley-Tukey FFT — same algorithm as the FFT in audio-analysis.ts. */
void fft(std::vector<double>& re, std::vector<double>& im) {
  size_t n = re.size();
  for (size_t i = 1, j = 0; i < n; i++) {
    size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      std::swap(re[i], re[j]);
      std::swap(im[i], im[j]);
    }
  }
  for (size_t len = 2; len <= n; len <<= 1) {
    size_t halfLen = len >> 1;
    double angleStep = (-2 * M_PI) / len;
    for (size_t start = 0; start < n; start += len) {
      for (size_t k = 0; k < halfLen; k++) {
        double angle = angleStep * k;
        double wRe = std::cos(angle);
        double wIm = std::sin(angle);
        size_t evenIdx = start + k;
        size_t oddIdx = start + k + halfLen;
        double oddRe = re[oddIdx] * wRe - im[oddIdx] * wIm;
        double oddIm = re[oddIdx] * wIm + im[oddIdx] * wRe;
        re[oddIdx] = re[evenIdx] - oddRe;
        im[oddIdx] = im[evenIdx] - oddIm;
        re[evenIdx] += oddRe;
        im[evenIdx] += oddIm;
      }
    }
  }
}

std::vector<double> frameChroma(const float* frame, int frameLength, double sampleRate) {
  int size = nextPowerOfTwo(frameLength);
  std::vector<double> re(size, 0.0), im(size, 0.0);
  for (int i = 0; i < frameLength; i++) {
    double w = 0.5 - 0.5 * std::cos((2 * M_PI * i) / (frameLength - 1 != 0 ? frameLength - 1 : 1));
    re[i] = frame[i] * w;
  }
  fft(re, im);

  std::vector<double> chroma(12, 0.0);
  const double minFreq = 65;
  const double maxFreq = 1050;
  for (int bin = 1; bin < size / 2; bin++) {
    double freq = (bin * sampleRate) / size;
    if (freq < minFreq || freq > maxFreq) continue;
    double magnitude = std::hypot(re[bin], im[bin]);
    double midiPitch = 69 + 12 * std::log2(freq / 440);
    int pitchClass = ((static_cast<int>(std::round(midiPitch)) % 12) + 12) % 12;
    chroma[pitchClass] += magnitude * magnitude;
  }
  return chroma;
}

double correlate(const std::vector<double>& a, const std::vector<double>& b) {
  double meanA = 0, meanB = 0;
  for (double v : a) meanA += v;
  for (double v : b) meanB += v;
  meanA /= a.size();
  meanB /= b.size();
  double num = 0, denomA = 0, denomB = 0;
  for (size_t i = 0; i < a.size(); i++) {
    double da = a[i] - meanA;
    double db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  double denom = std::sqrt(denomA * denomB);
  return denom > 0 ? num / denom : 0;
}

std::vector<double> rotate(const double profile[12], int n) {
  std::vector<double> out(12);
  for (int i = 0; i < 12; i++) {
    int idx = ((i - n) % 12 + 12 * 100) % 12;
    out[i] = profile[idx];
  }
  return out;
}

struct KeyEstimate {
  std::string key; // empty if none
  double confidence;
};

KeyEstimate estimateKey(const std::vector<float>& samples, double sampleRate, double durationSec) {
  if (durationSec < 4) return {"", 0.0};

  double frameSec = std::min(2.0, durationSec / 4);
  int frameSize = static_cast<int>(std::round(frameSec * sampleRate));
  const double offsets[6] = {0.1, 0.25, 0.4, 0.55, 0.7, 0.85};
  std::vector<double> chromaSum(12, 0.0);
  int framesUsed = 0;

  for (double offsetRatio : offsets) {
    int start = static_cast<int>(std::floor(offsetRatio * samples.size()));
    int end = std::min(static_cast<int>(samples.size()), start + frameSize);
    if (end - start < frameSize / 2) continue;
    auto chroma = frameChroma(samples.data() + start, end - start, sampleRate);
    for (int i = 0; i < 12; i++) chromaSum[i] += chroma[i];
    framesUsed++;
  }

  if (framesUsed == 0) return {"", 0.0};
  std::vector<double> chroma(12);
  for (int i = 0; i < 12; i++) chroma[i] = chromaSum[i] / framesUsed;

  double bestScore = -std::numeric_limits<double>::infinity();
  double secondScore = -std::numeric_limits<double>::infinity();
  std::string bestLabel;

  for (int tonic = 0; tonic < 12; tonic++) {
    double majorScore = correlate(chroma, rotate(MAJOR_PROFILE, tonic));
    double minorScore = correlate(chroma, rotate(MINOR_PROFILE, tonic));
    struct Candidate {
      double score;
      std::string label;
    };
    Candidate candidates[2] = {
        {majorScore, std::string(PITCH_CLASSES[tonic]) + " major"},
        {minorScore, std::string(PITCH_CLASSES[tonic]) + " minor"},
    };
    for (auto& c : candidates) {
      if (c.score > bestScore) {
        secondScore = bestScore;
        bestScore = c.score;
        bestLabel = c.label;
      } else if (c.score > secondScore) {
        secondScore = c.score;
      }
    }
  }

  double confidence = std::max(0.0, std::min(1.0, bestScore - secondScore));
  return {bestLabel, confidence};
}

std::string camelotForKey(const std::string& key) {
  if (key.empty()) return "";
  // key is "<Pitch> major" or "<Pitch> minor"
  size_t space = key.find(' ');
  if (space == std::string::npos) return "";
  std::string pitch = key.substr(0, space);
  std::string mode = key.substr(space + 1);
  int semitone = -1;
  for (int i = 0; i < 12; i++) {
    if (pitch == PITCH_CLASSES[i]) {
      semitone = i;
      break;
    }
  }
  if (semitone < 0) return "";
  bool isMinor = mode == "minor";
  int idx = isMinor ? (semitone + 3) % 12 : semitone;
  int number = MAJOR_CAMELOT_NUMBER_BY_SEMITONE[idx];
  return std::to_string(number) + (isMinor ? "A" : "B");
}

} // namespace

struct TrackAnalysisResult {
  double bpm;
  double bpmConfidence;
  double beatGridOffsetSec;
  double energyOnsetSec;
  std::string key; // empty string means null
  double keyConfidence;
  std::string camelotKey; // empty string means null
  double breakdownAtSec; // NaN means null
  double dropAtSec;      // NaN means null
  val waveformPeaks;
  bool fallback;
};

TrackAnalysisResult analyzeSamplesJs(const val& samplesArray, double sampleRate, double durationSec) {
  std::vector<float> samples = emscripten::vecFromJSArray<float>(samplesArray);

  auto envelope = computeEnergyEnvelope(samples, sampleRate);
  double envelopeRateHz = 1 / ENVELOPE_HOP_SEC;
  auto onsetEnvelope = computeOnsetEnvelope(envelope);

  TempoEstimate tempo = estimateTempo(onsetEnvelope, envelopeRateHz);
  double usableBpm = tempo.confidence >= MIN_TEMPO_CONFIDENCE ? tempo.bpm : FALLBACK_BPM;

  double beatGridOffsetSec = findBeatGridOffset(onsetEnvelope, envelopeRateHz);
  double energyOnsetSec = findEnergyOnset(envelope, envelopeRateHz);

  bool hasBreakdown = false;
  double breakdownAtSec = findBreakdown(envelope, envelopeRateHz, energyOnsetSec, hasBreakdown);
  bool hasDrop = false;
  double dropAtSec = findEnergyPeak(envelope, envelopeRateHz, hasDrop);

  auto waveformPeaksVec = downsampleForWaveform(envelope);
  val waveformPeaks = val::array();
  for (size_t i = 0; i < waveformPeaksVec.size(); i++) {
    waveformPeaks.set(i, waveformPeaksVec[i]);
  }

  KeyEstimate keyEstimate = estimateKey(samples, sampleRate, durationSec);

  TrackAnalysisResult result{
      usableBpm,
      tempo.confidence,
      beatGridOffsetSec,
      energyOnsetSec,
      keyEstimate.key,
      keyEstimate.confidence,
      keyEstimate.key.empty() ? "" : camelotForKey(keyEstimate.key),
      hasBreakdown ? breakdownAtSec : std::numeric_limits<double>::quiet_NaN(),
      hasDrop ? dropAtSec : std::numeric_limits<double>::quiet_NaN(),
      waveformPeaks,
      tempo.confidence < MIN_TEMPO_CONFIDENCE,
  };
  return result;
}

EMSCRIPTEN_BINDINGS(analysis_module) {
  emscripten::value_object<TrackAnalysisResult>("TrackAnalysisResult")
      .field("bpm", &TrackAnalysisResult::bpm)
      .field("bpmConfidence", &TrackAnalysisResult::bpmConfidence)
      .field("beatGridOffsetSec", &TrackAnalysisResult::beatGridOffsetSec)
      .field("energyOnsetSec", &TrackAnalysisResult::energyOnsetSec)
      .field("key", &TrackAnalysisResult::key)
      .field("keyConfidence", &TrackAnalysisResult::keyConfidence)
      .field("camelotKey", &TrackAnalysisResult::camelotKey)
      .field("breakdownAtSec", &TrackAnalysisResult::breakdownAtSec)
      .field("dropAtSec", &TrackAnalysisResult::dropAtSec)
      .field("waveformPeaks", &TrackAnalysisResult::waveformPeaks)
      .field("fallback", &TrackAnalysisResult::fallback);

  emscripten::function("analyzeSamples", &analyzeSamplesJs);
}
