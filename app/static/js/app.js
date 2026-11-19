const app = document.querySelector("#app");
const PLAYER_KEY = "chainline-player";
const SOUND_KEY = "chainline-sound";

let playerId = null;
let home = null;
let screen = "boot";
let roundId = null;
let soundOn = localStorage.getItem(SOUND_KEY) !== "0";
let ws = null;
let socketGen = 0;
let view = null;
let selectedId = "mako3";
let release = "flat";
let kind = "midrange";
let stick = [0, 0];
let latched = [0, -0.66];
let latchedKey = "";
const keys = new Set();
let pending = [];
let audioCtx = null;
let master = null;
let noiseCache = null;
let keeper = null;
let speaker = null;
let audioPrimed = false;
let claimedAt = 0;
let anim = null;
let seenThrow = -1;
let windNode = null;
let birdTimer = 0;
let loopStarted = false;
let camLie = null;
let camFrom = null;
let camTo = null;
let camMoveStart = 0;
let lookYaw = 0;
let aimStamp = 0;
let nextArm = 0;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new Error(typeof detail === "string" ? detail : "The course did not answer.");
  }
  return body;
}

document.addEventListener("keydown", (event) => {
  if (screen !== "play") return;
  const once = { KeyJ: "throw", Space: "throw" };
  if (once[event.code]) {
    event.preventDefault();
    if (!event.repeat) queueThrow();
  }
  if (event.code === "Digit1") setKind("putter");
  if (event.code === "Digit2") setKind("midrange");
  if (event.code === "Digit3") setKind("driver");
  if (event.code === "KeyQ") setRelease("hyzer");
  if (event.code === "KeyW") setRelease("flat");
  if (event.code === "KeyE") setRelease("anhyzer");
  keys.add(event.code);
});

document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

document.addEventListener("touchmove", (event) => {
  if (screen === "play") event.preventDefault();
}, { passive: false });

function axis(negative, positive) {
  return (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);
}

function readAim() {
  let ax = stick[0];
  let ay = stick[1];
  if (Math.hypot(ax, ay) < 0.08) {
    const kx = axis("ArrowLeft", "ArrowRight");
    const ky = axis("ArrowUp", "ArrowDown");
    if (Math.hypot(kx, ky) > 0.1) {
      ax = kx;
      ay = ky;
    }
  }
  if (Math.hypot(ax, ay) > 0.08) {
    const mag = Math.min(1, Math.hypot(ax, ay));
    const norm = Math.hypot(ax, ay) || 1;
    const softened = softenStick((ax / norm) * mag, (ay / norm) * mag);
    const next = aimFromStick(softened[0], softened[1]);
    const now = performance.now();
    const dt = aimStamp ? Math.min(0.05, (now - aimStamp) / 1000) : 0.016;
    aimStamp = now;
    const follow = 1 - Math.exp(-dt * 1.25);
    latched = [
      latched[0] + (next[0] - latched[0]) * follow,
      latched[1] + (next[1] - latched[1]) * follow,
    ];
  }
  return latched;
}

function softenStick(ax, ay) {
  const mag = Math.hypot(ax, ay);
  if (mag < 1e-4) return [0, 0];
  let nx = ax / mag;
  const ny = ay / mag;
  nx = Math.sign(nx) * Math.pow(Math.abs(nx), 2.45);
  const scale = Math.hypot(nx, ny) || 1;
  return [(nx / scale) * mag, (ny / scale) * mag];
}

function aimFromStick(ax, ay) {
  const mag = Math.min(1, Math.hypot(ax, ay));
  const norm = Math.hypot(ax, ay) || 1;
  const forward = -ay / norm;
  const right = ax / norm;
  const fx = Math.cos(lookYaw);
  const fy = Math.sin(lookYaw);
  const rx = fy;
  const ry = -fx;
  const wx = fx * forward + rx * right;
  const wy = fy * forward + ry * right;
  let angle = Math.atan2(wy, wx);
  if (view && view.hole && view.lie) {
    const toward = Math.atan2(view.hole.basket[1] - view.lie[1], view.hole.basket[0] - view.lie[0]);
    const off = wrapAngle(angle - toward);
    const hold = Math.exp(-(off / 0.36) * (off / 0.36));
    angle = toward + off * (1 - hold * 0.62);
  }
  return [Math.cos(angle) * mag, -Math.sin(angle) * mag];
}

function wrapAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function faceLie(snapshot) {
  const hole = snapshot.hole;
  const dx = hole.basket[0] - snapshot.lie[0];
  const dy = hole.basket[1] - snapshot.lie[1];
  return Math.atan2(dy, dx);
}

function aimAlongLook(power) {
  return [Math.cos(lookYaw) * power, -Math.sin(lookYaw) * power];
}

function composeInput() {
  const aim = readAim();
  const pressed = pending.splice(0, pending.length);
  return {
    cmd: "input",
    aim,
    power: Math.min(1, Math.hypot(aim[0], aim[1])),
    pressed,
    disc: selectedId,
    release,
  };
}

function send() {
  if (!ws || ws.readyState !== 1 || screen !== "play") return;
  if (view && view.status !== "playing") return;
  ws.send(JSON.stringify(composeInput()));
}

setInterval(send, 80);

function queueThrow() {
  if (anim || !view || view.status !== "playing") return;
  pending.push("throw");
  send();
  throwSound();
}

function clickWav() {
  const rate = 22050;
  const count = 1400;
  const bytes = 44 + count * 2;
  const buffer = new ArrayBuffer(bytes);
  const data = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) data.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  data.setUint32(4, bytes - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  write(36, "data");
  data.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) {
    const env = (1 - i / count) ** 2;
    const sample = Math.sin((2 * Math.PI * 640 * i) / rate) * env * 0.7;
    data.setInt16(44 + i * 2, sample * 32767, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function unlockAudio(event) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return Promise.resolve();
  try {
    if (!audioCtx) {
      audioCtx = new Context();
      master = audioCtx.createGain();
      master.gain.value = soundOn ? 0.9 : 0;
      master.connect(audioCtx.destination);
    } else if (master) {
      master.gain.value = soundOn ? 0.9 : 0;
    }
    if (audioCtx.state !== "running") {
      const silent = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
      const poke = audioCtx.createBufferSource();
      poke.buffer = silent;
      poke.connect(audioCtx.destination);
      poke.start();
    }
    if (!keeper) {
      const quiet = audioCtx.createGain();
      quiet.gain.value = 0.00001;
      keeper = audioCtx.createOscillator();
      keeper.frequency.value = 20;
      keeper.connect(quiet);
      quiet.connect(audioCtx.destination);
      keeper.start();
    }
    if (!speaker) {
      speaker = document.createElement("audio");
      speaker.setAttribute("playsinline", "");
      speaker.setAttribute("webkit-playsinline", "");
      speaker.preload = "auto";
      speaker.src = clickWav();
      speaker.volume = soundOn ? 0.45 : 0;
      document.body.appendChild(speaker);
    }
    const kindName = event && event.type;
    const gesture = !kindName || kindName === "touchend" || kindName === "click" || kindName === "keydown";
    let heard = false;
    if (!audioPrimed && gesture && performance.now() - claimedAt > 40) {
      claimedAt = performance.now();
      speaker.currentTime = 0;
      const played = speaker.play();
      if (played && played.catch) played.catch(() => {});
      if (soundOn) blip();
      heard = true;
    }
    const waiting = (audioCtx.state === "suspended" || audioCtx.state === "interrupted")
      ? audioCtx.resume()
      : Promise.resolve();
    loadChains();
    return Promise.resolve(waiting).then(() => {
      if (heard && audioCtx && audioCtx.state === "running") audioPrimed = true;
    });
  } catch (_error) {
    /* The round still plays if this phone blocks the speaker. */
  }
  return Promise.resolve();
}

document.addEventListener("touchstart", unlockAudio, true);
document.addEventListener("touchend", unlockAudio, true);
document.addEventListener("pointerdown", unlockAudio, true);
document.addEventListener("click", unlockAudio, true);
document.addEventListener("keydown", unlockAudio, true);

function liveAudio() {
  if (!soundOn || !audioCtx || !master || audioCtx.state === "closed") return false;
  if (audioCtx.state !== "running") {
    try { audioCtx.resume(); } catch (_error) { return false; }
  }
  return true;
}

function blip() {
  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, now);
  oscillator.frequency.linearRampToValueAtTime(420, now + 0.07);
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.08);
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.09);
}

function noiseBuffer() {
  if (noiseCache) return noiseCache;
  const rate = audioCtx.sampleRate;
  noiseCache = audioCtx.createBuffer(1, rate, rate);
  const data = noiseCache.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseCache;
}

function noise(seconds, freq, q, peak) {
  if (!liveAudio()) return;
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer();
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(now);
  source.stop(now + seconds + 0.02);
}

function tone(freq, duration, type, peak, slide) {
  if (!liveAudio()) return;
  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, now);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, slide), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function throwSound() {
  const disc = currentDisc();
  const low = disc && disc.kind === "driver";
  noise(low ? 0.28 : 0.18, low ? 700 : 1400, 0.7, 0.28);
  tone(low ? 280 : 480, 0.16, "sine", 0.08, 140);
}

let chainBytes = null;
let chainBuffer = null;
let chainLoading = null;

fetch("/static/audio/chains.wav")
  .then((res) => res.arrayBuffer())
  .then((buf) => { chainBytes = buf; })
  .catch(() => {});

function loadChains() {
  if (chainBuffer) return Promise.resolve(chainBuffer);
  if (!audioCtx) return Promise.resolve(null);
  if (chainLoading) return chainLoading;
  const bytes = chainBytes
    ? Promise.resolve(chainBytes)
    : fetch("/static/audio/chains.wav").then((res) => res.arrayBuffer());
  chainLoading = bytes
    .then((buf) => audioCtx.decodeAudioData(buf.slice(0)))
    .then((decoded) => {
      chainBuffer = decoded;
      return decoded;
    })
    .catch(() => null);
  return chainLoading;
}

function chainSound() {
  const play = () => {
    if (!liveAudio() || !chainBuffer) return;
    const source = audioCtx.createBufferSource();
    source.buffer = chainBuffer;
    const gain = audioCtx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(master);
    source.start();
  };
  if (chainBuffer) play();
  else loadChains().then(play);
}

function treeSound() {
  noise(0.12, 280, 0.8, 0.4);
  tone(110, 0.1, "sine", 0.12, 70);
}

function splashSound() {
  noise(0.45, 420, 0.5, 0.32);
  tone(180, 0.3, "sine", 0.08, 80);
}

function chime(name) {
  if (name === "Ace") [523, 659, 784, 1046].forEach((freq, i) => setTimeout(() => tone(freq, 0.22, "triangle", 0.14), i * 110));
  else if (name === "Eagle") [494, 659, 880].forEach((freq, i) => setTimeout(() => tone(freq, 0.18, "triangle", 0.12), i * 100));
  else if (name === "Birdie") { tone(587, 0.16, "triangle", 0.12); setTimeout(() => tone(784, 0.2, "triangle", 0.12), 120); }
  else if (name === "Par") tone(520, 0.16, "sine", 0.08);
  else if (name === "Bogey" || name === "Double" || name === "Pickup") tone(220, 0.22, "sine", 0.08, 140);
}

function startWind() {
  if (!liveAudio() || windNode) return;
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer();
  source.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.03;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start();
  windNode = source;
}

function stopWind() {
  if (windNode) {
    try { windNode.stop(); } catch (_error) { /* already stopped */ }
    windNode = null;
  }
}

function currentDisc() {
  if (!view) return null;
  return view.bag.find((disc) => disc.id === selectedId) || view.disc;
}

function boot() {
  playerId = Number(localStorage.getItem(PLAYER_KEY) || 0);
  if (!playerId) {
    renderName();
    return;
  }
  loadHome().catch(() => {
    localStorage.removeItem(PLAYER_KEY);
    renderName();
  });
}

async function loadHome() {
  home = await api(`/api/home?player_id=${playerId}`);
  renderHome();
}

function renderName() {
  screen = "name";
  document.body.classList.remove("playing");
  closeSocket();
  app.innerHTML = `
    <section class="home gate">
      <p class="eyebrow">Pine Bend</p>
      <h1>Chainline</h1>
      <p class="lede">Type your name. The same name brings your rounds back.</p>
      <form id="join" class="card stack">
        <input id="name" maxlength="24" placeholder="Your name" autocomplete="nickname" enterkeyhint="done">
        <button class="primary" type="submit">Continue</button>
        <p class="error" id="err"></p>
      </form>
    </section>`;
  const input = app.querySelector("#name");
  input.focus();
  app.querySelector("#join").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = app.querySelector("#err");
    err.textContent = "";
    try {
      const created = await api("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.value }),
      });
      playerId = created.id;
      localStorage.setItem(PLAYER_KEY, String(playerId));
      await loadHome();
    } catch (error) {
      err.textContent = error.message;
    }
  });
}

function renderHome() {
  screen = "home";
  document.body.classList.remove("playing");
  closeSocket();
  stopWind();
  const player = home.player;
  const active = home.active;
  const best = player.best_label || "—";
  const molds = home.bag.map((disc) => `
    <span class="mold"><i class="swatch" style="background:${esc(disc.color)}"></i>${esc(disc.name)} <span class="brand">${esc(disc.brand)}</span></span>
  `).join("");
  app.innerHTML = `
    <section class="home">
      <p class="eyebrow">${esc(home.course.name)} · Par ${home.course.par}</p>
      <h1>Chainline</h1>
      <p class="lede">Eighteen holes, each one its own shape. Aim with the stick. Throw.</p>
      <div class="card">
        <strong>${esc(player.name)}</strong>
        <div class="stats" style="margin-top:10px">
          <div><strong>${player.rounds_played}</strong><span>Rounds</span></div>
          <div><strong>${esc(best)}</strong><span>Best</span></div>
          <div><strong>${player.aces}</strong><span>Aces</span></div>
        </div>
        <div class="stack" style="margin-top:14px">
          <button class="primary" id="go" type="button">${active ? `Resume hole ${active.hole}` : "Tee off"}</button>
          ${active ? `<button id="fresh" type="button">New round</button>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="how">
          <p>The bag is Innova and MVP. Putter, midrange, or driver on every throw. Hyzer finishes left. Anhyzer finishes right. Flat lets the disc fly its own numbers.</p>
          <p>The basket stays in front of you. Drag the fairway to look around. The line starts on the disc and shows the throw. A small lean stays on the basket. Inside 3 ft is a gimmie.</p>
          <p>Keyboard: arrows aim, J or Space throws. The first tap clicks. On an iPhone the mute switch silences the page.</p>
        </div>
        <div class="bag-preview">${molds}</div>
        <div class="row">
          <button class="quiet" id="sound" type="button">${soundOn ? "Sound on" : "Sound off"}</button>
          <button class="quiet" id="forget" type="button">Not ${esc(player.name)}</button>
        </div>
      </div>
    </section>`;
  app.querySelector("#go").addEventListener("click", () => startRound(false));
  const fresh = app.querySelector("#fresh");
  if (fresh) fresh.addEventListener("click", () => startRound(true));
  app.querySelector("#sound").addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
    if (master) master.gain.value = soundOn ? 0.9 : 0;
    if (speaker) speaker.volume = soundOn ? 0.45 : 0;
    renderHome();
  });
  app.querySelector("#forget").addEventListener("click", () => {
    localStorage.removeItem(PLAYER_KEY);
    playerId = null;
    renderName();
  });
}

async function startRound(fresh) {
  const body = await api("/api/rounds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_id: playerId, fresh }),
  });
  showPlay(body.round.id, body.view);
}

function showPlay(id, firstView) {
  screen = "play";
  roundId = id;
  view = firstView;
  selectedId = firstView.disc.id;
  release = firstView.release;
  kind = firstView.disc.kind;
  stick = [0, 0];
  lookYaw = faceLie(firstView);
  latched = aimAlongLook(firstView.putting ? 0.5 : 0.46);
  latchedKey = lieKey(firstView);
  seenThrow = firstView.throw_seq;
  anim = null;
  document.body.classList.add("playing");
  app.innerHTML = `
    <section class="play">
      <header class="hud">
        <div>
          <div class="hole-kicker" id="kicker"></div>
          <div class="hole-name" id="hole-name"></div>
          <div class="meta" id="meta"></div>
          <div class="blurb" id="blurb"></div>
        </div>
        <div class="hud-side">
          <div class="scorebig" id="to-par"></div>
          <div class="dots" id="dots"></div>
          <div class="hud-buttons">
            <button type="button" id="card">Card</button>
            <button type="button" id="leave">Leave</button>
          </div>
        </div>
      </header>
      <div class="stage">
        <canvas id="course"></canvas>
        <div class="log" id="log"></div>
        <div class="veil hidden" id="veil"></div>
      </div>
      <div class="bag">
        <label class="disc-label" for="disc">Disc</label>
        <select id="disc"></select>
        <div class="releases" id="releases"></div>
      </div>
      <div class="deck">
        <div class="stick" id="aim"><div class="knob"></div><span>Aim</span></div>
        <div class="throw-col">
          <div class="power-wrap">
            <span>Power</span>
            <div class="power"><i id="power-fill"></i></div>
          </div>
          <button type="button" id="throw">Throw</button>
        </div>
      </div>
    </section>`;
  bindStick(app.querySelector("#aim"));
  bindLook(app.querySelector("#course"));
  app.querySelector("#throw").addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (view && !anim && (view.status === "holed" || view.status === "finished")) {
      if (view.status === "finished") showResult();
      else walkOn();
      return;
    }
    queueThrow();
  });
  app.querySelector("#leave").addEventListener("click", () => boot());
  app.querySelector("#card").addEventListener("click", () => showCard(false));
  paintBag();
  paintHud();
  connect(id);
  if (firstView.status === "holed" || firstView.status === "finished") showResult();
  startWind();
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(frame);
  }
}

function bindLook(canvas) {
  let pointer = null;
  let lastX = 0;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointer = event.pointerId;
    lastX = event.clientX;
    canvas.setPointerCapture(pointer);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    lookYaw -= (event.clientX - lastX) * 0.012;
    lastX = event.clientX;
    if (Math.hypot(stick[0], stick[1]) < 0.08) {
      const power = Math.min(1, Math.hypot(latched[0], latched[1])) || 0.46;
      latched = aimAlongLook(power);
    }
  });
  const end = (event) => {
    if (event.pointerId === pointer) pointer = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

function lieKey(snapshot) {
  return `${snapshot.hole_index}:${snapshot.lie[0]}:${snapshot.lie[1]}:${snapshot.status}`;
}

function paintBag() {
  const disc = currentDisc();
  if (!disc || !view) return;
  const menu = app.querySelector("#disc");
  const releases = app.querySelector("#releases");
  if (!menu || !releases) return;
  const labels = { putter: "Putters", midrange: "Midranges", driver: "Drivers" };
  menu.innerHTML = ["putter", "midrange", "driver"].map((name) => {
    const options = view.bag.filter((item) => item.kind === name).map((item) => `
      <option value="${esc(item.id)}" ${item.id === selectedId ? "selected" : ""}>${esc(item.name)} · ${esc(item.brand)} · ${esc(item.numbers)}</option>
    `).join("");
    return `<optgroup label="${labels[name]}">${options}</optgroup>`;
  }).join("");
  if (menu.dataset.bound !== "1") {
    menu.dataset.bound = "1";
    menu.addEventListener("change", () => {
      selectedId = menu.value;
      const picked = currentDisc();
      if (picked) kind = picked.kind;
      const thrown = app.querySelector("#throw");
      if (thrown && picked) {
        thrown.style.background = picked.color;
        thrown.style.borderColor = picked.rim;
        thrown.style.color = inkFor(picked.color);
      }
      send();
    });
  }
  releases.innerHTML = ["hyzer", "flat", "anhyzer"].map((name) => `
    <button type="button" data-release="${name}" class="${name === release ? "on" : ""}">${name[0].toUpperCase()}${name.slice(1)}</button>
  `).join("");
  releases.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => setRelease(button.dataset.release));
  });
  const button = app.querySelector("#throw");
  if (button && disc) {
    button.style.background = disc.color;
    button.style.borderColor = disc.rim;
    button.style.color = inkFor(disc.color);
  }
}

function setKind(next) {
  kind = next;
  const inKind = view && view.bag.filter((item) => item.kind === kind);
  if (inKind && !inKind.some((item) => item.id === selectedId)) selectedId = inKind[0].id;
  paintBag();
  send();
}

function setRelease(next) {
  release = next;
  paintBag();
  send();
}

function inkFor(hex) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (r * 0.3 + g * 0.59 + b * 0.11) > 160 ? "#142016" : "#f7fbf4";
}

function paintHud() {
  if (!view || screen !== "play") return;
  const hole = view.hole;
  const kicker = app.querySelector("#kicker");
  if (!kicker) return;
  kicker.textContent = `Hole ${hole.number} · Par ${hole.par} · ${hole.length_ft} ft`;
  app.querySelector("#hole-name").textContent = hole.name;
  const target = view.status === "playing" ? `${view.distance_ft} ft to the basket` : view.score_name;
  app.querySelector("#meta").textContent = `${view.strokes} thrown · ${hole.hill} · ${view.wind_label} · ${target}`;
  app.querySelector("#blurb").textContent = view.message || hole.blurb;
  app.querySelector("#to-par").textContent = view.to_par_label;
  const dots = app.querySelector("#dots");
  dots.innerHTML = Array.from({ length: hole.par }, (_, index) => `<i class="${index < view.strokes ? "on" : ""}"></i>`).join("");
  const button = app.querySelector("#throw");
  if (button) {
    const done = !anim && (view.status === "holed" || view.status === "finished");
    button.disabled = !done && (view.status !== "playing" || !!anim);
    if (done && view.status === "finished") button.textContent = "Card";
    else if (done && view.hole_index >= 17) button.textContent = "See the card";
    else if (done) button.textContent = "Next hole";
    else button.textContent = "Throw";
  }
  const fill = app.querySelector("#power-fill");
  if (fill) fill.style.width = `${Math.round(Math.min(1, Math.hypot(latched[0], latched[1])) * 100)}%`;
}

function bindStick(el) {
  const knob = el.querySelector(".knob");
  let pointer = null;
  function place(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width * 0.42;
    const mag = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(mag, max);
    dx = (dx / mag) * clamped;
    dy = (dy / mag) * clamped;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick = [dx / max, dy / max];
    readAim();
  }
  function end(event) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    knob.style.transform = "translate(0px, 0px)";
    stick = [0, 0];
  }
  el.addEventListener("pointerdown", (event) => {
    pointer = event.pointerId;
    el.setPointerCapture(pointer);
    place(event.clientX, event.clientY);
    event.preventDefault();
  });
  el.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointer) place(event.clientX, event.clientY);
  });
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("contextmenu", (event) => event.preventDefault());
}

function connect(id) {
  const gen = ++socketGen;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/api/rounds/${id}/play?player_id=${playerId}`);
  ws = socket;
  socket.onmessage = (event) => {
    if (gen !== socketGen) return;
    accept(JSON.parse(event.data));
  };
  socket.onclose = () => {
    if (gen !== socketGen || screen !== "play") return;
    setTimeout(() => {
      if (screen === "play" && gen === socketGen) connect(id);
    }, 700);
  };
}

function closeSocket() {
  socketGen += 1;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function accept(next) {
  const prevStatus = view ? view.status : "";
  const holeChanged = !view || next.hole_index !== view.hole_index;
  view = next;
  if (holeChanged) {
    selectedId = next.disc.id;
    release = next.release;
    kind = next.disc.kind;
    lookYaw = faceLie(next);
    latched = aimAlongLook(next.putting ? 0.5 : 0.46);
    latchedKey = lieKey(next);
    camLie = next.lie.slice();
    camFrom = camLie.slice();
    camTo = camLie.slice();
    camMoveStart = performance.now();
    paintBag();
  }
  if (next.last_throw && next.last_throw.seq !== seenThrow && next.throw_seq !== seenThrow) {
    seenThrow = next.last_throw.seq;
    startAnim(next.last_throw);
  }
  paintHud();
  const veil = app.querySelector("#veil");
  if (holeChanged && next.status === "playing" && veil && veil.querySelector("#next")) {
    veil.classList.add("hidden");
  }
  // A later aim update used to open this sheet again after Next hole, so the first tap looked ignored.
  if (!anim && next.status !== prevStatus && (next.status === "holed" || next.status === "finished")) showResult();
}

function startAnim(throwData) {
  const samples = throwData.samples || [];
  if (samples.length > 1) {
    lookYaw = Math.atan2(samples[1][1] - samples[0][1], samples[1][0] - samples[0][0]);
  }
  const dt = (throwData.dt || 0.06) * 1000 / 1.25;
  anim = {
    data: throwData,
    started: performance.now(),
    stepMs: dt,
    count: Math.max(1, samples.length - 1),
    heard: {},
  };
}

function hearFlight(simTime, done) {
  if (!anim) return;
  (anim.data.events || []).forEach((item, index) => {
    if (anim.heard[index]) return;
    if (simTime + 0.03 < (item.t || 0) && !done) return;
    anim.heard[index] = true;
    if (item.kind === "chains") chainSound();
    if (item.kind === "tree") treeSound();
  });
}

function frame(now) {
  if (screen === "play") {
    readAim();
    if (view && !anim && Math.hypot(stick[0], stick[1]) < 0.08) {
      const key = lieKey(view);
      if (key !== latchedKey && view.status === "playing") {
        lookYaw = faceLie(view);
        latched = aimAlongLook(view.putting ? 0.5 : 0.46);
        latchedKey = key;
      }
    }
    if (anim) {
      const elapsed = now - anim.started;
      const index = Math.min(anim.count, elapsed / anim.stepMs);
      anim.index = index;
      const simTime = index * (anim.data.dt || 0.06);
      const finished = index >= anim.count;
      hearFlight(simTime, finished);
      if (finished) {
        const done = anim.data;
        const caught = (done.events || []).some((item, index) => item.kind === "chains" && anim.heard[index]);
        if (done.result === "chains" && !caught) chainSound();
        anim = null;
        if (done.result === "water") splashSound();
        if (done.result === "ob") tone(90, 0.18, "sine", 0.1, 55);
        if (view && (view.status === "holed" || view.status === "finished")) {
          chime(view.score_name);
          showResult();
        }
        if (view) {
          lookYaw = faceLie(view);
          latched = aimAlongLook(view.putting ? 0.5 : 0.46);
          latchedKey = lieKey(view);
        }
      }
    }
    if (soundOn && !windNode) startWind();
    if (soundOn && now - birdTimer > 9000) {
      birdTimer = now + Math.random() * 4000;
      birdCall();
    }
    paintHud();
    draw();
  }
  requestAnimationFrame(frame);
}

function birdCall() {
  if (!liveAudio()) return;
  tone(1700 + Math.random() * 400, 0.09, "sine", 0.05, 2400);
  setTimeout(() => tone(1500 + Math.random() * 300, 0.08, "sine", 0.04, 1900), 120);
}

function showResult() {
  if (!view || screen !== "play") return;
  if (view.status !== "holed" && view.status !== "finished") return;
  const veil = app.querySelector("#veil");
  if (!veil || !veil.classList.contains("hidden")) return;
  const last = view.hole_index >= 17 && view.status === "holed";
  const finished = view.status === "finished";
  veil.classList.remove("hidden");
  if (finished) {
    veil.innerHTML = cardSheet(true);
    bindCard(veil, true);
    return;
  }
  veil.innerHTML = `
    <div class="sheet">
      <h2>${esc(view.score_name || "Hole")}</h2>
      <p>Hole ${view.hole.number}, ${view.hole.name}. ${view.strokes} throws, par ${view.hole.par}. ${esc(view.message || "")}</p>
      <button class="primary" id="next" type="button">${last ? "See the card" : "Next hole"}</button>
    </div>`;
  veil.querySelector("#next").addEventListener("pointerdown", (event) => {
    event.preventDefault();
    walkOn();
  });
}

function walkOn() {
  if (!view || view.status !== "holed") return;
  const holeIndex = view.hole_index;
  if (performance.now() >= nextArm) {
    nextArm = performance.now() + 700;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ cmd: "next" }));
  }
  const veil = app.querySelector("#veil");
  if (veil) veil.classList.add("hidden");
  window.setTimeout(() => {
    if (!view || view.hole_index !== holeIndex || view.status !== "holed") return;
    showResult();
  }, 700);
}

function showCard(force) {
  const veil = app.querySelector("#veil");
  if (!veil || !view) return;
  if (!force && view.status === "playing" && !veil.classList.contains("hidden")) {
    veil.classList.add("hidden");
    return;
  }
  veil.classList.remove("hidden");
  veil.innerHTML = cardSheet(view.status === "finished");
  bindCard(veil, view.status === "finished");
}

function cardSheet(canSave) {
  const rows = view.card.map((row) => `
    <tr>
      <td>${row.number}</td>
      <td>${esc(row.name)}</td>
      <td class="num">${row.par}</td>
      <td class="num">${row.score == null ? "" : row.score}</td>
    </tr>`).join("");
  return `
    <div class="sheet">
      <h2>${esc(view.to_par_label)}</h2>
      <p>${view.total_strokes} throws through ${view.scores.length} holes. Par ${view.par_total}.</p>
      <table class="card-table">
        <thead><tr><th>#</th><th>Hole</th><th class="num">Par</th><th class="num">You</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${canSave ? `<button class="primary" id="save" type="button">Save the round</button>` : `<button id="close-card" type="button">Back to the hole</button>`}
    </div>`;
}

function bindCard(veil, canSave) {
  const close = veil.querySelector("#close-card");
  if (close) close.addEventListener("click", () => veil.classList.add("hidden"));
  const save = veil.querySelector("#save");
  if (save && canSave) {
    save.addEventListener("click", async () => {
      try {
        await api(`/api/rounds/${roundId}/resolve?player_id=${playerId}`, { method: "POST" });
        boot();
      } catch (error) {
        save.textContent = error.message;
      }
    });
  }
}

function draw() {
  const canvas = app.querySelector("#course");
  if (!canvas || !view) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hole = view.hole;
  const thrown = flightPoint();
  const cam = lookAt(hole, cameraStand(), w, h);
  paintSky(ctx, w, h, cam.horizon);
  paintGround(ctx, cam, hole);
  const scenery = hole.trees.map((tree) => {
    const foot = cam.project(tree[0], tree[1], groundAt(hole, tree[0], tree[1]));
    return { kind: "pine", tree, foot };
  }).concat((hole.bushes || []).map((bush) => {
    const foot = cam.project(bush[0], bush[1], groundAt(hole, bush[0], bush[1]));
    return { kind: "bush", bush, foot };
  })).filter((item) => !item.foot.behind).sort((a, b) => b.foot.depth - a.foot.depth);
  const basketGround = groundAt(hole, hole.basket[0], hole.basket[1]);
  const basketPoint = cam.project(hole.basket[0], hole.basket[1], basketGround);
  const drawOne = (item) => {
    if (item.kind === "pine") drawPine(ctx, item.foot, item.tree);
    else drawBush(ctx, item.foot, item.bush);
  };
  scenery.filter((item) => item.foot.depth > basketPoint.depth + 0.4).forEach(drawOne);
  if (!basketPoint.behind) drawBasketAt(ctx, basketPoint, Math.hypot(hole.basket[0] - cam.lx, hole.basket[1] - cam.ly));
  scenery.filter((item) => item.foot.depth <= basketPoint.depth + 0.4).forEach(drawOne);
  markBasket(ctx, cam, hole, basketPoint, w);
  if (view.status === "playing" && !anim) drawAimLine(ctx, cam, hole, w, h);
  if (thrown && thrown.air) drawFlyingDisc(ctx, cam, thrown);
  else drawInHand(ctx, w, h, currentDisc() || view.disc);
  drawWind(ctx, hole, w);
}

function cameraStand() {
  const target = anim && anim.data.samples && anim.data.samples[0]
    ? [anim.data.samples[0][0], anim.data.samples[0][1]]
    : view.lie;
  const now = performance.now();
  if (!camLie) {
    camLie = target.slice();
    camFrom = target.slice();
    camTo = target.slice();
    camMoveStart = now;
    return camLie;
  }
  const moved = !camTo || Math.hypot(camTo[0] - target[0], camTo[1] - target[1]) > 0.2;
  if (moved) {
    camFrom = camLie.slice();
    camTo = target.slice();
    camMoveStart = now;
  }
  if (Math.hypot(stick[0], stick[1]) > 0.05 && !anim) {
    camLie = target.slice();
    camFrom = camLie.slice();
    camTo = target.slice();
    camMoveStart = now;
    return camLie;
  }
  const span = Math.hypot(camTo[0] - camFrom[0], camTo[1] - camFrom[1]);
  const duration = Math.min(640, 260 + span * 8);
  const t = Math.min(1, (now - camMoveStart) / duration);
  const eased = t * t * (3 - 2 * t);
  camLie = [
    camFrom[0] + (camTo[0] - camFrom[0]) * eased,
    camFrom[1] + (camTo[1] - camFrom[1]) * eased,
  ];
  return camLie;
}

function lookAt(hole, stand, width, height) {
  const [lx, ly] = stand;
  const fx = Math.cos(lookYaw);
  const fy = Math.sin(lookYaw);
  const dist = Math.max(4, Math.hypot(hole.basket[0] - lx, hole.basket[1] - ly));
  const rx = fy;
  const ry = -fx;
  const eyeZ = groundAt(hole, lx, ly) + 1.62;
  const focal = Math.min(width, height) * 1.05;
  const horizon = height * 0.4;
  return {
    lx, ly, fx, fy, rx, ry, eyeZ, focal, horizon, width, height, dist,
    project(x, y, z) {
      const dx = x - lx;
      const dy = y - ly;
      const depth = dx * fx + dy * fy;
      const lateral = dx * rx + dy * ry;
      const safe = Math.max(0.55, depth);
      const scale = focal / safe;
      return {
        x: width / 2 + lateral * scale,
        y: horizon + (eyeZ - z) * scale,
        scale,
        depth: safe,
        behind: depth < 0.45,
      };
    },
    world(depth, lateral) {
      return {
        x: lx + fx * depth + rx * lateral,
        y: ly + fy * depth + ry * lateral,
      };
    },
  };
}

function contourAt(hole, x, y) {
  const number = hole.number || 1;
  const basketD = Math.hypot(x - hole.basket[0], y - hole.basket[1]);
  const teeD = Math.hypot(x - hole.tee[0], y - hole.tee[1]);
  const fade = Math.min(Math.max(0, (basketD - 16) / 22), Math.max(0, (teeD - 18) / 24), 1);
  const roll = Math.sin(x * 0.05 + number) * 0.9 + Math.cos(y * 0.034 + number * 0.4) * 0.7;
  return roll * fade;
}

function groundAt(hole, x, y) {
  const dx = hole.basket[0] - hole.tee[0];
  const dy = hole.basket[1] - hole.tee[1];
  const span = dx * dx + dy * dy;
  let along = span < 1 ? 0 : ((x - hole.tee[0]) * dx + (y - hole.tee[1]) * dy) / span;
  along = Math.max(0, Math.min(1, along));
  let height = (hole.elevation || 0) * along + contourAt(hole, x, y);
  (hole.hills || []).forEach((hill) => {
    const radius = hill[3] || 1;
    const d = Math.hypot(x - hill[0], y - hill[1]) / radius;
    if (d < 1) height += hill[2] * (1 - d * d);
  });
  return height;
}

function paintSky(ctx, width, height, horizon) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon + 30);
  sky.addColorStop(0, "#7eb6e0");
  sky.addColorStop(0.72, "#d5ecf8");
  sky.addColorStop(1, "#e7f0d4");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
}

function paintGround(ctx, cam, hole) {
  const maxDepth = Math.max(36, cam.dist + 22);
  const depths = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    depths.push(1.15 + (maxDepth - 1.15) * t * t);
  }
  const columns = 16;
  const half = Math.max(26, cam.dist * 0.55);
  for (let i = 0; i < depths.length - 1; i += 1) {
    for (let j = 0; j < columns; j += 1) {
      const d0 = depths[i];
      const d1 = depths[i + 1];
      const a0 = -half + (2 * half * j) / columns;
      const a1 = -half + (2 * half * (j + 1)) / columns;
      const midDepth = (d0 + d1) / 2;
      const midLat = (a0 + a1) / 2;
      const mid = cam.world(midDepth, midLat);
      const corners = [cam.world(d0, a0), cam.world(d0, a1), cam.world(d1, a1), cam.world(d1, a0)];
      const points = corners.map((point) => cam.project(point.x, point.y, groundAt(hole, point.x, point.y)));
      if (points.some((point) => point.behind)) continue;
      ctx.beginPath();
      points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.closePath();
      ctx.fillStyle = groundColor(hole, mid.x, mid.y, midDepth, midLat, cam);
      ctx.fill();
    }
  }
}

function groundColor(hole, x, y, depth, lateral, cam) {
  const wet = inWater(hole, x, y);
  if (wet) {
    const nearer = cam.world(Math.max(1, depth - 1.6), lateral);
    if (!inWater(hole, nearer.x, nearer.y)) return "#d7f4f8";
    return ((Math.floor(x / 3) + Math.floor(y / 2)) % 2) ? "#1787aa" : "#136f90";
  }
  if (hole.ob.some((poly) => pointInPoly(x, y, poly))) return "#c6a56a";
  const straw = hole.trees.some((tree) => Math.hypot(x - tree[0], y - tree[1]) < 2.2);
  const fair = hole.fairway.some((poly) => pointInPoly(x, y, poly));
  if (straw && !fair) return (Math.floor(x + y) % 2) ? "#c4a15a" : "#a8843e";
  const dx = hole.basket[0] - hole.tee[0];
  const dy = hole.basket[1] - hole.tee[1];
  const span = dx * dx + dy * dy || 1;
  const along = Math.max(0, Math.min(1, ((x - hole.tee[0]) * dx + (y - hole.tee[1]) * dy) / span));
  const extra = groundAt(hole, x, y) - (hole.elevation || 0) * along;
  if (fair && extra > 0.7) return (Math.floor(y / 5) % 2) ? "#8fbe62" : "#7eae52";
  if (fair && extra < -0.55) return (Math.floor(y / 5) % 2) ? "#2f8a40" : "#267838";
  if (fair) return (Math.floor(y / 5) % 2) ? "#4eae55" : "#3d9846";
  if (extra > 0.8) return (Math.floor((x + y) / 7) % 2) ? "#3d7a42" : "#2f6836";
  return (Math.floor((x + y) / 7) % 2) ? "#1e5c34" : "#174828";
}

function inWater(hole, x, y) {
  if (hole.dry.some((circle) => Math.hypot(x - circle[0], y - circle[1]) <= circle[2])) return false;
  return hole.water.some((poly) => pointInPoly(x, y, poly));
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function markBasket(ctx, cam, hole, point, width) {
  const dx = hole.basket[0] - cam.lx;
  const dy = hole.basket[1] - cam.ly;
  const depth = dx * cam.fx + dy * cam.fy;
  const lateral = dx * cam.rx + dy * cam.ry;
  const off = point.behind || point.x < 28 || point.x > width - 28;
  if (!off && depth > 1) return;
  const onLeft = Math.atan2(lateral, depth) < 0;
  ctx.fillStyle = "rgba(20, 32, 18, 0.72)";
  ctx.font = "600 13px sans-serif";
  const label = onLeft ? "‹ Basket" : "Basket ›";
  const x = onLeft ? 12 : width - 12 - ctx.measureText(label).width;
  ctx.fillText(label, x, cam.horizon + 22);
}

function drawBush(ctx, foot, bush) {
  if (foot.depth < 1.1 || foot.depth > 170) return;
  const s = foot.scale;
  const width = Math.max(7, (bush[2] || 1.4) * s * 1.15);
  const height = width * 0.72;
  ctx.fillStyle = "#1f6a34";
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y - height * 0.42, width * 0.55, height * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3d9a4c";
  ctx.beginPath();
  ctx.ellipse(foot.x - width * 0.22, foot.y - height * 0.62, width * 0.32, height * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#145228";
  ctx.beginPath();
  ctx.ellipse(foot.x + width * 0.18, foot.y - height * 0.28, width * 0.26, height * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPine(ctx, foot, tree) {
  if (foot.depth < 1.1 || foot.depth > 240) return;
  const x = tree[0];
  const y = tree[1];
  const vary = Math.abs(Math.sin(x * 0.37 + y * 0.21));
  const height = 13 + vary * 5;
  const s = foot.scale;
  const h = height * s;
  const trunkW = Math.max(2, 0.34 * s);
  const top = foot.y - h;
  ctx.fillStyle = "#4e3420";
  ctx.fillRect(foot.x - trunkW / 2, top, trunkW, h);
  ctx.fillStyle = "#7a5a38";
  ctx.fillRect(foot.x - trunkW / 2, top, Math.max(1, trunkW * 0.32), h);
  const crown = h * 0.26;
  ctx.strokeStyle = "#1d5c32";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, trunkW * 0.45);
  const limbs = 4;
  for (let i = 0; i < limbs; i += 1) {
    const ly = top + crown * ((i + 0.35) / limbs);
    const len = trunkW * (2.1 + (i % 2) * 0.7);
    const side = i % 2 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(foot.x, ly);
    ctx.lineTo(foot.x + side * len, ly + len * 0.62);
    ctx.moveTo(foot.x, ly + 1.5);
    ctx.lineTo(foot.x - side * len * 0.72, ly + len * 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = "#174e2c";
  ctx.beginPath();
  ctx.moveTo(foot.x, top - trunkW * 1.1);
  ctx.lineTo(foot.x + trunkW * 1.5, top + crown * 0.18);
  ctx.lineTo(foot.x - trunkW * 1.5, top + crown * 0.18);
  ctx.closePath();
  ctx.fill();
}

function drawBasketAt(ctx, point, distance) {
  // The picture: yellow band, separate oval chain links, an open wire cage, a thin pole into the ground.
  const boosted = 680 / Math.pow(Math.max(distance, 2.2), 0.7);
  const ppm = Math.max(point.scale, boosted);
  const yAt = (meters) => point.y - meters * ppm;
  const cx = point.x;
  const bandTop = 1.62;
  const bandBot = 1.32;
  const cageTop = 0.84;
  const cageBot = 0.54;
  const bandRx = 0.34 * ppm;
  const bandRy = Math.max(2.4, 0.08 * ppm);
  const cageRx = 0.5 * ppm;
  const cageRy = Math.max(2.6, 0.1 * ppm);
  const outline = Math.max(1.25, ppm * 0.016);

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(cx, point.y + ppm * 0.03, ppm * 0.34, ppm * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  const poleW = Math.max(2.4, ppm * 0.042);
  const poleTop = yAt(cageBot + 0.08);
  ctx.fillStyle = "#c5ced3";
  ctx.fillRect(cx - poleW / 2, poleTop, poleW, point.y - poleTop);
  ctx.fillStyle = "#eef3f5";
  ctx.fillRect(cx - poleW / 2, poleTop, Math.max(1, poleW * 0.28), point.y - poleTop);
  ctx.strokeStyle = "#1c2124";
  ctx.lineWidth = outline * 0.85;
  ctx.strokeRect(cx - poleW / 2, poleTop, poleW, point.y - poleTop);

  const cageStroke = () => {
    ctx.strokeStyle = "#3c444a";
    ctx.lineWidth = Math.max(1.15, ppm * 0.018);
  };
  const ring = (y, rx, ry, from, to) => {
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, from, to);
    ctx.stroke();
  };
  cageStroke();
  const topY = yAt(cageTop);
  const botY = yAt(cageBot);
  const midY = (topY + botY) / 2;
  ring(topY, cageRx, cageRy, Math.PI, 0);
  ring(botY, cageRx * 0.92, cageRy * 0.85, Math.PI, 0);
  ring(midY, cageRx * 0.96, cageRy * 0.9, Math.PI, 0);
  const bars = 13;
  for (let i = 0; i < bars; i += 1) {
    const t = i / (bars - 1);
    const x = cx + (t - 0.5) * cageRx * 2;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(cx + (t - 0.5) * cageRx * 1.84, botY);
    ctx.stroke();
  }

  const chainTop = yAt(bandBot) + bandRy * 0.2;
  const chainBot = topY + Math.max(4, cageRy * 0.9);
  const span = Math.max(10, chainBot - chainTop);
  const chains = 9;
  const links = 7;
  for (let i = 0; i < chains; i += 1) {
    const t = i / (chains - 1);
    const x0 = cx + (t - 0.5) * bandRx * 1.7;
    const x1 = cx + (t - 0.5) * bandRx * 1.45;
    const step = span / links;
    const ry = step * 0.48;
    const rx = ry * 0.58;
    ctx.strokeStyle = "#2b3136";
    ctx.lineWidth = Math.max(1.35, Math.min(rx * 0.42, 3.2));
    for (let link = 0; link < links; link += 1) {
      const u = (link + 0.5) / links;
      const lx = x0 + (x1 - x0) * u;
      const ly = chainTop + span * u;
      ctx.beginPath();
      ctx.ellipse(lx, ly, Math.max(1.15, rx), Math.max(2.1, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  cageStroke();
  ring(topY, cageRx, cageRy, 0, Math.PI);
  ring(botY, cageRx * 0.92, cageRy * 0.85, 0, Math.PI);
  ring(midY, cageRx * 0.96, cageRy * 0.9, 0, Math.PI);
  ctx.beginPath();
  ctx.ellipse(cx, topY, cageRx, cageRy, 0, 0, Math.PI * 2);
  ctx.stroke();

  const top = yAt(bandTop);
  const bot = yAt(bandBot);
  ctx.beginPath();
  ctx.moveTo(cx - bandRx, top);
  ctx.lineTo(cx - bandRx, bot);
  ctx.ellipse(cx, bot, bandRx, bandRy, 0, Math.PI, 0, true);
  ctx.lineTo(cx + bandRx, top);
  ctx.ellipse(cx, top, bandRx, bandRy, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = "#f0a41a";
  ctx.fill();
  ctx.fillStyle = "#ffd056";
  ctx.beginPath();
  ctx.ellipse(cx, top, bandRx, bandRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = outline;
  ctx.beginPath();
  ctx.ellipse(cx, top, bandRx, bandRy, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - bandRx, top);
  ctx.lineTo(cx - bandRx, bot);
  ctx.moveTo(cx + bandRx, top);
  ctx.lineTo(cx + bandRx, bot);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, bot, bandRx, bandRy, 0, 0, Math.PI);
  ctx.stroke();
}

function drawAimLine(ctx, cam, hole, width, height) {
  const aim = readAim();
  const power = Math.min(1, Math.hypot(aim[0], aim[1]));
  if (power < 0.08) return;
  const angle = Math.atan2(-aim[1], aim[0]);
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const rightX = ay;
  const rightY = -ax;
  const disc = currentDisc() || view.disc;
  const hyzer = release === "hyzer" ? 1 : release === "anhyzer" ? -1 : 0;
  const turn = (disc.turn || 0) + hyzer * 1.25;
  const fade = Math.max(0, (disc.fade || 0) + hyzer * 1.55);
  const speed = (disc && disc.speed) || 5;
  let full = Math.min(125, 20 + speed * 16 - speed * speed * 0.55);
  if (cam.dist < 30) full = Math.min(full, cam.dist * 1.25 + 1);
  const reach = Math.max(8, full * (0.34 + 0.66 * power));
  const basket = hole.basket;
  const shape = (-turn) * 0.045 - fade * 0.055;
  let landX = cam.lx + ax * reach + rightX * shape * reach;
  let landY = cam.ly + ay * reach + rightY * shape * reach;
  if (Math.hypot(landX - basket[0], landY - basket[1]) < 5) {
    landX = basket[0];
    landY = basket[1];
  }
  const landing = cam.project(landX, landY, groundAt(hole, landX, landY) + 0.4);
  const start = { x: width / 2, y: height - 22 };
  const finish = landing.behind ? { x: start.x, y: start.y - height * 0.35 } : landing;
  const c1x = start.x * 0.62 + finish.x * 0.38;
  const c1y = start.y * 0.38 + finish.y * 0.62;
  const pts = [start];
  for (let i = 1; i <= 24; i += 1) {
    const u = i / 24;
    const omu = 1 - u;
    pts.push({
      x: omu * omu * start.x + 2 * omu * u * c1x + u * u * finish.x,
      y: omu * omu * start.y + 2 * omu * u * c1y + u * u * finish.y,
    });
  }
  if (pts.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = (disc && disc.color) || "#f4f0e6";
  ctx.lineWidth = 2.4 + power * 2.4;
  ctx.stroke();
  const end = pts[pts.length - 1];
  ctx.fillStyle = (disc && disc.color) || "#f4f0e6";
  ctx.beginPath();
  ctx.arc(end.x, end.y, 5 + power * 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlyingDisc(ctx, cam, lie) {
  const hole = view.hole;
  const point = cam.project(lie.x, lie.y, lie.z);
  if (point.behind || point.depth < 1.4) return;
  const radius = Math.max(4, 0.13 * point.scale);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  const shadow = cam.project(lie.x, lie.y, groundAt(hole, lie.x, lie.y));
  if (!shadow.behind) {
    ctx.beginPath();
    ctx.ellipse(shadow.x, shadow.y, radius * 0.9, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(-(lie.heading || 0));
  ctx.fillStyle = lie.color || "#f4f0e6";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = lie.rim || "#fff";
  ctx.lineWidth = Math.max(1.5, radius * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawInHand(ctx, width, height, disc) {
  if (!disc) return;
  ctx.save();
  ctx.translate(width / 2, height - 18);
  ctx.fillStyle = disc.color || "#f4f0e6";
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = disc.rim || "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawWind(ctx, hole, width) {
  const [wx, wy] = hole.wind;
  const mag = Math.hypot(wx, wy);
  if (mag < 0.4) return;
  const cx = width - 36;
  const cy = 28;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + wx * 6, cy - wy * 6);
  ctx.stroke();
}
function flightPoint() {
  if (!anim || !anim.data.samples.length) return null;
  const samples = anim.data.samples;
  const index = Math.min(samples.length - 1, anim.index || 0);
  const i0 = Math.floor(index);
  const i1 = Math.min(samples.length - 1, i0 + 1);
  const t = index - i0;
  const a = samples[i0];
  const b = samples[i1];
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  return {
    x,
    y,
    z,
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
    color: anim.data.color,
    rim: anim.data.rim,
    air: true,
  };
}

boot();
