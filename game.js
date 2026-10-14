"use strict";

// ===== PARAMETRAR FÖR KONTINUERLIG FREKVENSMÄTNING =====
// 1. MÄTINTERVALL i millisekunder: 100 = cirka 10 mätningar/sekund.
const FREQUENCY_INTERVAL_MS = 100;
// 2. LJUDFÖNSTER i samples: 4096 = cirka 85 ms vid 48000 Hz.
// AnalyserNode kräver en tvåpotens mellan 32 och 32768.
// Fönstret behöver vara längre än maxTau i calculateFrequency.
const AUDIO_WINDOW_SAMPLES = 4096;
// =====================================================

let microphoneStream = null;
let microphoneContext = null;
let microphoneSource = null;
let microphoneAnalyser = null;
let microphoneSamples = null;
let frequencyTimer = null;

// Variabler för frekvensvisningen.
const frequencyEl = document.querySelector("#frequency-value");
let z;
let refFreq = null;
let selectedFrequencyMethod = null;

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const overlay = document.querySelector("#overlay");
const title = document.querySelector("#overlay-title");
const message = document.querySelector("#overlay-text");

const startButton = document.querySelector("#start");
const methodButtons = document.querySelector("#method-buttons");
const hpsButton = document.querySelector("#method-hps");
const yinButton = document.querySelector("#method-yin");
const pauseButton = document.querySelector("#pause");
const scoreEl = document.querySelector("#score");
const livesEl = document.querySelector("#lives");

const W = 1100;
const H = 620;
const lanes = 5;

const laneY = (i) => 105 + i * 102;

const state = {
  mode: "ready",
  lane: 2,
  displayY: laneY(2),
  lives: 3,
  score: 0,
  objects: [],
  spawn: 0,
  time: 0,
  invulnerable: 0,
  last: 0,
};

// Den sparade ljudinspelningen.
let calibrationRecording = null;

const types = [
  { icon: "🥤", size: 43 },
  { icon: "🛍️", size: 46 },
  { icon: "🧴", size: 43 },
  { icon: "🥡", size: 43 },
  { icon: "🛴", size: 48, electric: true },
];

function reset() {
  Object.assign(state, {
    mode: "playing",
    lane: 2,
    displayY: laneY(2),
    lives: 3,
    score: 0,
    objects: [],
    spawn: 0.7,
    time: 0,
    invulnerable: 0,
    last: 0,
  });

  updateHud();

  overlay.classList.add("hidden");
  pauseButton.disabled = false;
  pauseButton.textContent = "Pausa";

  requestAnimationFrame(loop);
}

function updateHud() {
  scoreEl.textContent = state.score;

  livesEl.textContent = Array.from({ length: 3 }, (_, i) =>
    i < state.lives ? "❤️" : "🖤",
  ).join(" ");

  livesEl.setAttribute("aria-label", `${state.lives} liv kvar`);
}

function move(delta) {
  if (state.mode === "playing") {
    state.lane = Math.max(0, Math.min(4, state.lane + delta));
  }
}

function showScreen(heading, body, button) {
  title.textContent = heading;
  message.textContent = body;
  startButton.textContent = button;
  startButton.hidden = false;
  methodButtons.hidden = true;

  overlay.classList.remove("hidden");
}

function pause() {
  if (state.mode === "playing") {
    state.mode = "paused";
    pauseButton.textContent = "Fortsätt";

    showScreen("Pausat", "Ta ett andetag innan du simmar vidare.", "Fortsätt");
  } else if (state.mode === "paused") {
    state.mode = "playing";
    state.last = 0;

    pauseButton.textContent = "Pausa";
    overlay.classList.add("hidden");

    requestAnimationFrame(loop);
  }
}

function spawn() {
  const type = types[Math.floor(Math.random() * types.length)];

  state.objects.push({
    x: W + 60,
    lane: Math.floor(Math.random() * lanes),
    ...type,
    passed: false,
    rotation: (Math.random() - 0.5) * 0.35,
  });
}

function update(dt) {
  state.time += dt;

  state.invulnerable = Math.max(0, state.invulnerable - dt);

  state.displayY += (laneY(state.lane) - state.displayY) * Math.min(1, dt * 14);

  state.spawn -= dt;

  if (state.spawn <= 0) {
    spawn();

    state.spawn =
      0.68 + Math.random() * 0.63 - Math.min(0.28, state.score * 0.005);
  }

  const speed = 260 + Math.min(190, state.score * 2.7);

  for (const obj of state.objects) {
    obj.x -= speed * dt;

    if (!obj.passed && obj.x < 160) {
      obj.passed = true;
      state.score++;

      updateHud();
    }

    if (
      state.invulnerable === 0 &&
      Math.abs(obj.x - 218) < 45 &&
      Math.abs(laneY(obj.lane) - state.displayY) < 43
    ) {
      state.lives--;
      state.invulnerable = 1.25;
      obj.x = -100;

      updateHud();

      if (state.lives === 0) {
        state.mode = "over";
        stopMicrophone();
        pauseButton.disabled = true;

        showScreen(
          "Havet vann den här gången",
          `Du tog dig förbi ${state.score} hinder. Försök igen!`,
          "Spela igen",
        );
      }
    }
  }

  state.objects = state.objects.filter((obj) => obj.x > -80);
}

function draw() {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);

  gradient.addColorStop(0, "#0c83a5");
  gradient.addColorStop(1, "#064667");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#b2f7ed18";

  for (let i = 0; i < 5; i++) {
    const y = laneY(i);

    ctx.fillRect(0, y - 43, W, 86);

    if (i < 4) {
      ctx.strokeStyle = "#a1eef238";
      ctx.setLineDash([8, 15]);

      ctx.beginPath();
      ctx.moveTo(0, y + 51);
      ctx.lineTo(W, y + 51);
      ctx.stroke();

      ctx.setLineDash([]);
    }
  }

  for (let i = 0; i < 30; i++) {
    const x =
      (((i * 179 - state.time * (23 + (i % 4) * 8)) % (W + 80)) + W + 80) %
      (W + 80);

    const y = 35 + ((i * 89) % H);

    ctx.beginPath();
    ctx.arc(x, y, 2 + (i % 4), 0, Math.PI * 2);

    ctx.fillStyle = "#c2f9ff44";
    ctx.fill();
  }

  ctx.fillStyle = "#cefaff88";
  ctx.font = "bold 16px system-ui";

  for (let i = 0; i < 5; i++) {
    ctx.fillText(String(i + 1), 32, laneY(i) + 5);
  }

  for (const obj of state.objects) {
    ctx.save();

    ctx.translate(obj.x, laneY(obj.lane));
    ctx.rotate(obj.rotation);

    ctx.font = `${obj.size}px system-ui, emoji`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "#003a4b";
    ctx.shadowBlur = 12;

    ctx.fillText(obj.icon, 0, 0);

    if (obj.electric) {
      ctx.shadowBlur = 0;
      ctx.font = "18px system-ui, emoji";

      ctx.fillText("⚡", 8, -30);
    }

    ctx.restore();
  }

  ctx.save();

  ctx.translate(218, state.displayY);
  ctx.scale(-1, 1);

  if (state.invulnerable > 0 && Math.floor(state.time * 12) % 2 === 0) {
    ctx.globalAlpha = 0.35;
  }

  ctx.shadowColor = "#052d36";
  ctx.shadowBlur = 18;

  ctx.font = "76px system-ui, emoji";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText("🐢", 0, 0);

  ctx.restore();

  ctx.fillStyle = "#042e4488";
  ctx.fillRect(0, H - 25, W, 25);

  ctx.fillStyle = "#69b9b1";

  for (let i = 0; i < 12; i++) {
    const x = (i * 120 - state.time * 30) % (W + 100);

    ctx.fillRect(x, H - 25, 2, 13);
  }
}

function loop(timestamp) {
  if (state.mode !== "playing") {
    return;
  }

  if (!state.last) {
    state.last = timestamp;
  }

  const dt = Math.min((timestamp - state.last) / 1000, 0.05);

  state.last = timestamp;

  update(dt);
  draw();

  if (state.mode === "playing") {
    requestAnimationFrame(loop);
  }
}

function beginCalibration() {
  stopMicrophone();
  state.mode = "calibration";
  pauseButton.disabled = true;

  z = undefined;
  refFreq = null;
  frequencyEl.textContent = "—";

  showScreen(
    "Sjung en lagom ton för kalibrering",
    "Tryck på Spela in och håll en ton i tre sekunder.",
    "Spela in",
  );
}

async function recordCalibration() {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    !window.MediaRecorder ||
    !window.AudioContext
  ) {
    message.textContent =
      "Mikrofoninspelning kräver en webbläsare med stöd " +
      "för ljudhantering och HTTPS eller localhost.";

    return;
  }

  state.mode = "recording";
  startButton.disabled = true;

  message.textContent = "Tillåt mikrofonen i webbläsaren för att börja.";

  let stream;
  let timer;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const recorder = new MediaRecorder(stream);
    const chunks = [];

    const recording = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      recorder.addEventListener(
        "stop",
        () => {
          const blob = new Blob(chunks, {
            type: recorder.mimeType,
          });

          if (blob.size === 0) {
            reject(new Error("Empty recording"));
          } else {
            resolve(blob);
          }
        },
        { once: true },
      );

      recorder.addEventListener(
        "error",
        () => {
          reject(new Error("Recording failed"));
        },
        { once: true },
      );

      recorder.start();

      timer = setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, 3000);
    });

    message.textContent = "Spelar in i tre sekunder… Sjung en lagom ton.";

    calibrationRecording = await recording;

    // Mikrofonen fortsätter vara på efter kalibreringen.

    // Avkodar inspelningen till samples.
    const audioContext = new AudioContext();

    try {
      const audioBuffer = await audioContext.decodeAudioData(
        await calibrationRecording.arrayBuffer(),
      );

      // Första ljudkanalens samples.
      const X = audioBuffer.getChannelData(0);

      // Samplingsfrekvens i Hz.
      const fs = audioBuffer.sampleRate;

      // Anropar din funktion och sparar resultatet i z.
      //z = calculateFrequency(X, fs);

      if (selectedFrequencyMethod === "HPS") {
        const length = 2 ** Math.floor(Math.log2(X.length));
        const start = Math.floor((X.length - AUDIO_WINDOW_SAMPLES) / 2);

        const x = X.slice(start, start + AUDIO_WINDOW_SAMPLES);

        z = calculateFrequency(X.subarray(0, length), fs);
      } else {
        //const X = audioBuffer.getChannelData(0);
        z = calculateFrequency(X, fs);
      }

      if (!Number.isFinite(z)) {
        refFreq = null;
        frequencyEl.textContent = String(z);
        state.mode = "calibration";
        showScreen(
          "Kalibreringen gav " + String(z),
          "Ingen giltig referensfrekvens kunde sparas. Sjung en ton och gör om kalibreringen.",
          "Gör om kalibreringen",
        );
        return;
      }
      refFreq = z;
      console.log("Kalibreringsfrekvens:", refFreq);

      // Visar resultatet i frekvensrutan.
      frequencyEl.textContent = Number.isFinite(z) ? z.toFixed(1) : "—";
    } finally {
      await audioContext.close();
    }

    // Samma mikrofonström används sedan för kontinuerliga samples.
    await startLiveFrequency(stream);

    state.mode = "calibrated";

    showScreen(
      "Inspelningen är klar",
      "Nu kan du börja spela med piltangenterna.",
      "Börja spela",
    );
  } catch (error) {
    state.mode = "calibration";

    if (error.name === "NotAllowedError") {
      message.textContent =
        "Mikrofontillstånd saknas. Tillåt mikrofonen " +
        "i webbläsaren och försök igen.";
    } else {
      message.textContent =
        "Det gick inte att spela in eller avkoda ljudet. " +
        "Kontrollera mikrofonen och försök igen.";
    }

    startButton.textContent = "Försök igen";
  } finally {
    clearTimeout(timer);

    // Behåll strömmen om den kontinuerliga mätningen startade.
    if (stream !== microphoneStream) {
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
    }

    startButton.disabled = false;
  }
}

// Hämtar samples från mikrofonen. Ingen pitch beräknas av AnalyserNode.
async function startLiveFrequency(stream) {
  const context = new AudioContext();
  let source;

  try {
    await context.resume();
    source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = AUDIO_WINDOW_SAMPLES;
    source.connect(analyser);
    // Ingen koppling till högtalarna: mikrofonljudet spelas inte upp.

    microphoneStream = stream;
    microphoneContext = context;
    microphoneSource = source;
    microphoneAnalyser = analyser;
    microphoneSamples = new Float32Array(AUDIO_WINDOW_SAMPLES);

    frequencyTimer = setInterval(() => {
      // Vid paus hålls mikrofonen på, men inga nya beräkningar görs.
      if (state.mode !== "playing") {
        return;
      }

      microphoneAnalyser.getFloatTimeDomainData(microphoneSamples);

      // TRÖSKELVÄRDET
      let sum = 0;

      for (let i = 0; i < microphoneSamples.length; i++) {
        sum += microphoneSamples[i] ** 2;
      }

      const amplitude = Math.sqrt(sum / microphoneSamples.length);
      //console.log(amplitude)

      // Tröskelvärde för brus och tystnad
      const threshold = 0.01;

      if (amplitude < threshold) {
        return;
      }

      z = calculateFrequency(microphoneSamples, microphoneContext.sampleRate);

      //här kanske är ett bra ställe att lägga till tröskelvärde för amplituden så att freq2Mov inte körs om ljudet är för lågt?
      freq2Mov(z); // <=================================================== implementera funktion och avkommentera denna

      frequencyEl.textContent = Number.isFinite(z) ? z.toFixed(1) : "—";
    }, FREQUENCY_INTERVAL_MS);
  } catch (error) {
    source?.disconnect();
    await context.close();
    throw error;
  }
}

// Stäng mikrofonen när spelet är slut eller en ny kalibrering börjar.
function stopMicrophone() {
  clearInterval(frequencyTimer);
  frequencyTimer = null;
  microphoneSource?.disconnect();
  microphoneStream?.getTracks().forEach((track) => track.stop());
  if (microphoneContext) {
    microphoneContext.close().catch(() => {});
  }
  microphoneStream = null;
  microphoneContext = null;
  microphoneSource = null;
  microphoneAnalyser = null;
  microphoneSamples = null;
}

window.addEventListener("pagehide", stopMicrophone);

function selectFrequencyMethod(method) {
  if (state.mode !== "ready") {
    return;
  }
  selectedFrequencyMethod = method;
  beginCalibration();
}

function handleStart() {
  if (state.mode === "paused") {
    pause();
  } else if (state.mode === "calibration") {
    recordCalibration();
  } else if (state.mode === "calibrated") {
    reset();
  } else if (state.mode !== "recording") {
    beginCalibration();
  }
}

window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === "ArrowUp" && !event.repeat) {
    move(-1);
  }

  if (event.code === "ArrowDown" && !event.repeat) {
    move(1);
  }

  if (
    event.code === "Space" &&
    !event.repeat &&
    ["playing", "paused"].includes(state.mode)
  ) {
    pause();
  }
});

document.querySelector("#up").addEventListener("click", () => move(-1));

document.querySelector("#down").addEventListener("click", () => move(1));

hpsButton.addEventListener("click", () => selectFrequencyMethod("HPS"));
yinButton.addEventListener("click", () => selectFrequencyMethod("YIN"));

pauseButton.addEventListener("click", pause);
startButton.addEventListener("click", handleStart);

draw();

//=============================EGNA FUNKTIONER=====================//
function calculateFrequency(X, fs) {
  if (selectedFrequencyMethod === "HPS") {
    return calcFreqHps(X, fs);
  }
  if (selectedFrequencyMethod === "YIN") {
    return calcFreqYin(X, fs);
  }
  throw new Error("Välj frekvensmätningsmetod först.");
}

//====================YIN=====================//
function calcFreqYin(X, fs) {
  const t = new Float64Array(X.length); //skapa en tom tids-array

  for (let i = 0; i < X.length; i++) {
    t[i] = i / fs;
  } //Array är nu fylld för med tidpunkterna för alla samples

  let maxTau = 0.0125; //Maximalt period som är rimlig att räkna på, motsvarar 80 Hz

  //--------Översätt maxTau till maxK-------//
  let maxK = 0;
  let minDistance = Infinity; //starta med stort värde

  for (let i = 0; i < t.length; i++) {
    const distance = Math.abs(t[i] - maxTau);

    if (distance < minDistance) {
      minDistance = distance;
      maxK = i;
    }
  }

  //---skappa undersök differenser för varje förskjutning--//

  const diffs = new Float64Array(maxK);

  for (let k = 1; k <= maxK; k++) {
    let indexSum = 0;
    for (let curr = 0; curr < X.length - k; curr++) {
      indexSum = indexSum + (X[curr] - X[k + curr]) ** 2;
    }
    diffs[k - 1] = indexSum;
  }

  //Beräkning för cummulative means-normalisering
  const diffsPrim = new Float64Array(maxK);

  for (let tau = 1; tau < diffs.length + 1; tau++) {
    let denominator = 0;
    for (let i = 0; i < tau; i++) {
      denominator = denominator + (1 / tau) * diffs[i];
    }
    diffsPrim[tau - 1] = diffs[tau - 1] / denominator;
  }

  let threshhold = 0.1;
  let tauIndex = -1;

  for (let i = 0; i < diffsPrim.length; i++) {
    if (diffsPrim[i] < threshhold) {
      tauIndex = i;
      break;
    }
  }

  if (tauIndex === -1) {
    return NaN;
  }

  const frequency = 1 / t[1 + tauIndex];
  return frequency;
}

//====================HPS=====================//
// Jag tog FFT funktionen från den här sidan
// https://github.com/lvillasen/FFT.js/blob/main/FFT.js
function FFT(signal) {
  if (signal.length == 1) return signal;
  var halfLength = signal.length / 2;
  var even = [];
  var odd = [];
  even.length = halfLength;
  odd.length = halfLength;
  for (var i = 0; i < halfLength; ++i) {
    even[i] = signal[i * 2];
    odd[i] = signal[i * 2 + 1];
  }
  even = FFT(even);
  odd = FFT(odd);
  for (var k = 0; k < halfLength; ++k) {
    if (!(even[k] instanceof Complex)) even[k] = new Complex(even[k], 0);
    if (!(odd[k] instanceof Complex)) odd[k] = new Complex(odd[k], 0);
    var a = Math.cos((2 * Math.PI * k) / signal.length);
    var b = Math.sin((-2 * Math.PI * k) / signal.length);
    //var sigma_k = new Complex(Math.cos(2 * Math.PI * k / signal.length), Math.sin(-2 * Math.PI * k / signal.length));
    var temp_k_real = odd[k].re * a - odd[k].im * b;
    var temp_k_imag = odd[k].re * b + odd[k].im * a;
    var A_k = new Complex(even[k].re + temp_k_real, even[k].im + temp_k_imag);
    var B_k = new Complex(even[k].re - temp_k_real, even[k].im - temp_k_imag);
    signal[k] = A_k;
    signal[k + halfLength] = B_k;
  }
  return signal;
}

function Complex(re, im) {
  this.re = re;
  this.im = im || 0.0;
}

// HPS funktionen
function calcFreqHps(x, fs) {
  /*
  // Ta bort DC-offset
  let mean = 0;

  for (let i = 0; i < x.length; i++) {
    mean += x[i];
  }

  mean = mean / x.length;

  x = Array.from(x, value => value - mean);
*/

  // Antal samples
  const L = x.length;

  // Hann-fönster
  let x_hann = [];

  for (let n = 0; n < L; n++) {
    let w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (L - 1)));

    x_hann[n] = x[n] * w;
  }

  // FFT
  let X = FFT(x_hann);

  // Amplituden
  const halfL = L / 2 + 1;
  let X_amp = [];

  for (let i = 0; i < halfL; i++) {
    let real = X[i].re;
    let imag = X[i].im;

    X_amp[i] = Math.sqrt(real * real + imag * imag);
  }

  // Frekvensaxel
  let f = [];

  for (let i = 0; i < halfL; i++) {
    f[i] = (i * fs) / L;
  }

  // HPS
  let HPS = [...X_amp];

  for (let h = 2; h <= 5; h++) {
    let downsample = [];

    for (let i = 0; i < X_amp.length; i += h) {
      downsample.push(X_amp[i]);
    }

    let len = downsample.length;

    for (let i = 0; i < len; i++) {
      HPS[i] = HPS[i] * downsample[i];
    }
  }

  // Gränser för rösten
  const minFreq = 80;
  const maxFreq = 1000;

  let HPSvoice = [];
  let f_voice = [];

  for (let i = 0; i < f.length; i++) {
    if (f[i] >= minFreq && f[i] <= maxFreq) {
      HPSvoice.push(HPS[i]);
      f_voice.push(f[i]);
    }
  }

  // Hitta största toppen
  let maxValue = Math.max(...HPSvoice);

  let index = HPSvoice.indexOf(maxValue);

  // Grundfrekvens
  let f0 = f_voice[index];

  return f0;
}

function freq2Mov(ref) {
  /*
  let freqMargin = 50;

  let maxFreq = refFreq + freqMargin;
  let minFreq = refFreq - freqMargin;

  if (ref >= maxFreq) {
    move(0 - state.lane);
  } else if (ref <= minFreq) {
    move(4 - state.lane);
  } else if (ref >= refFreq + 25) {
    move(1 - state.lane);
  } else if (ref <= refFreq - 20) {
    move(3 - state.lane);
  } else {
    move(2 - state.lane);
  }*/
  if (ref >= refFreq * 2 ** (4 / 12)) {
    move(0 - state.lane);
  } else if (ref <= refFreq * 2 ** (-4 / 12)) {
    move(4 - state.lane);
  } else if (ref >= refFreq * 2 ** (2 / 12)) {
    move(1 - state.lane);
  } else if (ref <= refFreq * 2 ** (-2 / 12)) {
    move(3 - state.lane);
  } else {
    move(2 - state.lane);
  }
}
