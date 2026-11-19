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
  if (Math.hypot(ax, ay) < 0.18) {
    const kx = axis("ArrowLeft", "ArrowRight");
    const ky = axis("ArrowUp", "ArrowDown");
    if (Math.hypot(kx, ky) > 0.1) {
      ax = kx;
      ay = ky;
    }
  }
  if (Math.hypot(ax, ay) > 0.18) {
    const mag = Math.min(1, Math.hypot(ax, ay));
    const norm = Math.hypot(ax, ay) || 1;
    latched = [(ax / norm) * mag, (ay / norm) * mag];
  }
  return latched;
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

function chainSound() {
  [1680, 2140, 2620, 1960, 2480].forEach((freq, index) => {
    setTimeout(() => tone(freq, 0.14, "triangle", 0.16, freq * 0.7), index * 28);
  });
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
      <p class="lede">Eighteen holes. Pick a disc. Aim. Throw.</p>
      <form id="join" class="card stack">
        <input id="name" maxlength="24" placeholder="Your name" autocomplete="nickname" enterkeyhint="done">
        <button class="primary" type="submit">Tee off</button>
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
      await startRound(false);
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
          <p>Up on the stick is up the map. Push farther for a harder throw. Water and the road cost a penalty, and you throw again from the same lie.</p>
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
  latched = pointAtBasket(firstView);
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
        <div class="kinds" id="kinds"></div>
        <div class="molds" id="molds"></div>
        <div class="releases" id="releases"></div>
      </div>
      <div class="deck">
        <div class="stick" id="aim"><div class="knob"></div><span>Aim</span></div>
        <div class="throw-col">
          <div class="power"><i id="power-fill"></i></div>
          <button type="button" id="throw">Throw</button>
        </div>
      </div>
    </section>`;
  bindStick(app.querySelector("#aim"));
  app.querySelector("#throw").addEventListener("pointerdown", (event) => {
    event.preventDefault();
    queueThrow();
  });
  app.querySelector("#leave").addEventListener("click", () => boot());
  app.querySelector("#card").addEventListener("click", () => showCard(false));
  paintBag();
  paintHud();
  connect(id);
  startWind();
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(frame);
  }
}

function lieKey(snapshot) {
  return `${snapshot.hole_index}:${snapshot.lie[0]}:${snapshot.lie[1]}:${snapshot.status}`;
}

function pointAtBasket(snapshot) {
  const dx = snapshot.hole.basket[0] - snapshot.lie[0];
  const dy = snapshot.hole.basket[1] - snapshot.lie[1];
  const mag = Math.hypot(dx, dy) || 1;
  const power = snapshot.putting ? 0.74 : 0.66;
  return [(dx / mag) * power, (-dy / mag) * power];
}

function paintBag() {
  const disc = currentDisc();
  if (!disc || !view) return;
  const kinds = app.querySelector("#kinds");
  const molds = app.querySelector("#molds");
  const releases = app.querySelector("#releases");
  if (!kinds) return;
  kinds.innerHTML = ["putter", "midrange", "driver"].map((name) => {
    const label = name === "midrange" ? "Mid" : name[0].toUpperCase() + name.slice(1);
    return `<button type="button" data-kind="${name}" class="${name === kind ? "on" : ""}">${label}</button>`;
  }).join("");
  molds.innerHTML = view.bag.filter((item) => item.kind === kind).map((item) => `
    <button type="button" data-disc="${esc(item.id)}" class="${item.id === selectedId ? "on" : ""}">
      ${esc(item.name)}
      <small>${esc(item.brand)} · ${esc(item.numbers)}</small>
    </button>`).join("");
  releases.innerHTML = ["hyzer", "flat", "anhyzer"].map((name) => `
    <button type="button" data-release="${name}" class="${name === release ? "on" : ""}">${name[0].toUpperCase()}${name.slice(1)}</button>
  `).join("");
  kinds.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => setKind(button.dataset.kind));
  });
  molds.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.disc;
      kind = currentDisc().kind;
      paintBag();
      send();
    });
  });
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
  if (button) button.disabled = view.status !== "playing" || !!anim;
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
    const max = rect.width * 0.32;
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
  const holeChanged = !view || next.hole_index !== view.hole_index;
  view = next;
  if (holeChanged) {
    selectedId = next.disc.id;
    release = next.release;
    kind = next.disc.kind;
    latched = pointAtBasket(next);
    latchedKey = lieKey(next);
    paintBag();
  }
  if (next.last_throw && next.last_throw.seq !== seenThrow && next.throw_seq !== seenThrow) {
    seenThrow = next.last_throw.seq;
    startAnim(next.last_throw);
  }
  paintHud();
  if (!anim && (next.status === "holed" || next.status === "finished")) showResult();
}

function startAnim(throwData) {
  const samples = throwData.samples || [];
  const dt = (throwData.dt || 0.06) * 1000 / 1.25;
  anim = { data: throwData, started: performance.now(), stepMs: dt, count: Math.max(1, samples.length - 1) };
  const played = new Set();
  anim.played = played;
  (throwData.events || []).forEach((item) => {
    const at = (item.t || 0) * 1000 / 1.25;
    setTimeout(() => {
      if (item.kind === "chains") chainSound();
      if (item.kind === "tree") treeSound();
    }, at);
  });
}

function frame(now) {
  if (screen === "play") {
    readAim();
    if (view && !anim && Math.hypot(stick[0], stick[1]) < 0.18) {
      const key = lieKey(view);
      if (key !== latchedKey && view.status === "playing") {
        latched = pointAtBasket(view);
        latchedKey = key;
      }
    }
    if (anim) {
      const elapsed = now - anim.started;
      const index = Math.min(anim.count, elapsed / anim.stepMs);
      anim.index = index;
      if (index >= anim.count) {
        const done = anim.data;
        anim = null;
        if (done.result === "water") splashSound();
        if (done.result === "ob") tone(90, 0.18, "sine", 0.1, 55);
        if (view && (view.status === "holed" || view.status === "finished")) {
          chime(view.score_name);
          showResult();
        }
        if (view) {
          latched = pointAtBasket(view);
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
  veil.querySelector("#next").addEventListener("click", () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ cmd: "next" }));
    veil.classList.add("hidden");
  });
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
  const cam = camera(frameBounds(hole.bounds, view.lie), w, h);
  ctx.fillStyle = "#163c26";
  ctx.fillRect(0, 0, w, h);
  roundedBounds(ctx, cam, hole.bounds, "#1e5c34");
  hole.fairway.forEach((poly) => {
    trace(ctx, cam, poly);
    ctx.fillStyle = "#3f9a45";
    ctx.fill();
    stripe(ctx, cam, poly, hole.bounds);
  });
  hole.ob.forEach((poly) => {
    trace(ctx, cam, poly);
    ctx.fillStyle = "#c6a56a";
    ctx.fill();
    hatch(ctx, cam, poly);
  });
  hole.water.forEach((poly) => {
    trace(ctx, cam, poly);
    const mid = cam.px(poly[0][0], poly[0][1]);
    ctx.fillStyle = "#1a86a8";
    ctx.fill();
    ctx.strokeStyle = "#b7e7f2";
    ctx.lineWidth = 2;
    ctx.stroke();
    void mid;
  });
  hole.dry.forEach((circle) => {
    const [sx, sy] = cam.px(circle[0], circle[1]);
    ctx.beginPath();
    ctx.arc(sx, sy, circle[2] * cam.scale, 0, Math.PI * 2);
    ctx.fillStyle = "#4eae55";
    ctx.fill();
    ctx.strokeStyle = "#d8f3c9";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  drawTee(ctx, cam, hole);
  hole.trees.forEach((tree) => drawTree(ctx, cam, tree));
  const thrown = flightPoint();
  if (view.last_throw && !anim) drawTrail(ctx, cam, view.last_throw.samples, view.last_throw.color);
  if (anim) drawTrail(ctx, cam, anim.data.samples.slice(0, Math.ceil(anim.index) + 1), anim.data.color);
  if (view.status === "playing") drawAim(ctx, cam);
  drawBasket(ctx, cam, hole.basket[0], hole.basket[1]);
  const lie = thrown || { x: view.lie[0], y: view.lie[1], z: 0, heading: 0, color: (currentDisc() || view.disc).color, rim: (currentDisc() || view.disc).rim, air: false };
  drawDisc(ctx, cam, lie.x, lie.y, lie.air ? lie.z : 0, lie.color, lie.rim, lie.heading, lie.air);
  drawWind(ctx, hole, w);
}

function frameBounds(bounds, lie) {
  const [minX, minY, maxX, maxY] = bounds;
  const pad = 14;
  return [
    Math.min(minX, lie[0] - pad),
    Math.min(minY, lie[1] - pad),
    Math.max(maxX, lie[0] + pad),
    Math.max(maxY, lie[1] + pad),
  ];
}

function camera(bounds, width, height) {
  const [minX, minY, maxX, maxY] = bounds;
  const pad = 14;
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const worldW = (maxX - minX) * scale;
  const worldH = (maxY - minY) * scale;
  const left = (width - worldW) / 2;
  const top = (height - worldH) / 2;
  return {
    scale,
    px(x, y) {
      return [left + (x - minX) * scale, top + (maxY - y) * scale];
    },
  };
}

function trace(ctx, cam, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const [sx, sy] = cam.px(point[0], point[1]);
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

function roundedBounds(ctx, cam, bounds, color) {
  const [minX, minY, maxX, maxY] = bounds;
  trace(ctx, cam, [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]);
  ctx.fillStyle = color;
  ctx.fill();
}

function stripe(ctx, cam, poly, bounds) {
  ctx.save();
  trace(ctx, cam, poly);
  ctx.clip();
  const [, minY, , maxY] = bounds;
  for (let y = Math.floor(minY); y < maxY; y += 8) {
    ctx.fillStyle = Math.floor(y / 8) % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
    const [x1, y1] = cam.px(bounds[0], y);
    const [x2, y2] = cam.px(bounds[2], y + 4);
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }
  ctx.restore();
}

function hatch(ctx, cam, poly) {
  ctx.save();
  trace(ctx, cam, poly);
  ctx.clip();
  ctx.strokeStyle = "rgba(120, 60, 40, 0.35)";
  ctx.lineWidth = 1;
  const start = cam.px(poly[0][0], poly[0][1]);
  for (let i = -40; i < 80; i += 1) {
    ctx.beginPath();
    ctx.moveTo(start[0] + i * 10, start[1] - 200);
    ctx.lineTo(start[0] + i * 10 + 80, start[1] + 200);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTee(ctx, cam, hole) {
  const [sx, sy] = cam.px(hole.tee[0], hole.tee[1]);
  const angle = Math.atan2(hole.basket[1] - hole.tee[1], hole.basket[0] - hole.tee[0]);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-angle);
  ctx.fillStyle = "#e6e1d4";
  ctx.fillRect(-cam.scale * 1.6, -cam.scale * 0.7, cam.scale * 3.2, cam.scale * 1.4);
  ctx.restore();
}

function drawTree(ctx, cam, tree) {
  const [sx, sy] = cam.px(tree[0], tree[1]);
  const radius = Math.max(5, tree[2] * cam.scale);
  const gradient = ctx.createRadialGradient(sx - radius * 0.28, sy - radius * 0.32, radius * 0.15, sx, sy, radius);
  gradient.addColorStop(0, "#67c56a");
  gradient.addColorStop(0.62, "#217a38");
  gradient.addColorStop(1, "#123f20");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6d4528";
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(1.6, radius * 0.16), 0, Math.PI * 2);
  ctx.fill();
}

function drawBasket(ctx, cam, x, y) {
  const [sx, sy] = cam.px(x, y);
  // Fixed screen size. A long bare pole reads as a flagstick, so the pole stays inside the chains.
  const s = Math.max(28, Math.min(46, cam.scale * 5.4));
  const floor = sy;
  const rim = floor - s * 0.4;
  const chainTop = rim - s * 0.58;
  const cap = chainTop - s * 0.1;
  const neck = s * 0.15;
  const halfRim = s * 0.42;
  const halfFloor = s * 0.48;

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(sx, floor + s * 0.05, halfFloor * 0.9, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#8e968f";
  ctx.lineWidth = Math.max(1.6, s * 0.05);
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(sx, cap);
  ctx.lineTo(sx, floor);
  ctx.stroke();

  const curtain = ctx.createLinearGradient(sx, chainTop, sx, rim);
  curtain.addColorStop(0, "#f4f6f4");
  curtain.addColorStop(1, "#8f9892");
  ctx.fillStyle = curtain;
  ctx.beginPath();
  ctx.moveTo(sx - neck, chainTop);
  ctx.lineTo(sx + neck, chainTop);
  ctx.lineTo(sx + halfRim * 0.92, rim);
  ctx.lineTo(sx - halfRim * 0.92, rim);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(35, 48, 40, 0.55)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let i = 0; i < 6; i += 1) {
    const t = (i + 0.5) / 6;
    ctx.beginPath();
    ctx.moveTo(sx + (t - 0.5) * neck * 2, chainTop);
    ctx.lineTo(sx + (t - 0.5) * halfRim * 1.84, rim);
    ctx.stroke();
  }

  ctx.fillStyle = "#f0c43a";
  ctx.beginPath();
  ctx.ellipse(sx, cap, neck * 0.9, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e7ebe8";
  ctx.lineWidth = Math.max(1.3, s * 0.045);
  ctx.beginPath();
  ctx.ellipse(sx, chainTop, neck, s * 0.038, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#f2c94b";
  ctx.beginPath();
  ctx.moveTo(sx - halfRim, rim);
  ctx.lineTo(sx + halfRim, rim);
  ctx.lineTo(sx + halfFloor, floor);
  ctx.lineTo(sx - halfFloor, floor);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#6d4c0c";
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.stroke();
  for (let i = 1; i <= 2; i += 1) {
    const t = i / 3;
    const yLine = rim + (floor - rim) * t;
    const half = halfRim + (halfFloor - halfRim) * t;
    ctx.beginPath();
    ctx.moveTo(sx - half, yLine);
    ctx.lineTo(sx + half, yLine);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ffe58a";
  ctx.lineWidth = Math.max(1.6, s * 0.055);
  ctx.beginPath();
  ctx.moveTo(sx - halfRim, rim);
  ctx.lineTo(sx + halfRim, rim);
  ctx.stroke();
}

function drawAim(ctx, cam) {
  const aim = readAim();
  const power = Math.min(1, Math.hypot(aim[0], aim[1]));
  if (power < 0.05 || !view) return;
  const angle = Math.atan2(-aim[1], aim[0]);
  const disc = currentDisc() || view.disc;
  const reach = power * (16 + disc.speed * 3.4);
  const x = view.lie[0] + Math.cos(angle) * reach;
  const y = view.lie[1] + Math.sin(angle) * reach;
  const [sx, sy] = cam.px(view.lie[0], view.lie[1]);
  const [ex, ey] = cam.px(x, y);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = disc.color;
  ctx.beginPath();
  ctx.arc(ex, ey, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrail(ctx, cam, samples, color) {
  if (!samples || samples.length < 2) return;
  ctx.strokeStyle = color || "#fff";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const [sx, sy] = cam.px(sample[0], sample[1]);
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawDisc(ctx, cam, x, y, z, color, rim, heading, air) {
  const [sx, sy] = cam.px(x, y);
  const lift = air ? Math.max(0, z) * cam.scale * 0.45 : 0;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(sx, sy, 7, 3, heading, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(sx, sy - lift);
  ctx.rotate(-heading);
  ctx.fillStyle = color || "#f4f0e6";
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rim || "#fff";
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
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
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
