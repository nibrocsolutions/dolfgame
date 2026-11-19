const totals = document.querySelector("#totals");
const rows = document.querySelector("#rows");
const err = document.querySelector("#err");
const ok = document.querySelector("#ok");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function when(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function load() {
  const response = await fetch("/api/admin/players");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    err.textContent = typeof body.detail === "string" ? body.detail : "The course did not answer.";
    return;
  }
  const summary = body.summary;
  totals.innerHTML = `
    <div><strong>${summary.players}</strong><span>Players</span></div>
    <div><strong>${summary.open_rounds}</strong><span>Open</span></div>
    <div><strong>${summary.saved_rounds}</strong><span>Saved</span></div>
    <div><strong>${summary.aces}</strong><span>Aces</span></div>
    <div><strong>${summary.birdies}</strong><span>Birdies</span></div>`;
  if (!body.players.length) {
    rows.innerHTML = `<tr><td colspan="7">No players yet.</td></tr>`;
    return;
  }
  rows.innerHTML = body.players.map((player) => `
    <tr>
      <td class="name">${esc(player.name)}</td>
      <td class="num">${player.rounds_played}</td>
      <td>${esc(player.best_label || "—")}</td>
      <td class="num">${player.aces}</td>
      <td class="num">${player.birdies}</td>
      <td>${esc(player.active ? player.active.label : "—")}</td>
      <td>${esc(when(player.last_at))}</td>
    </tr>`).join("");
}

document.querySelector("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  err.textContent = "";
  ok.textContent = "";
  const input = document.querySelector("#file");
  const file = input.files[0];
  if (!file) {
    err.textContent = "Choose a Chainline file.";
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (_error) {
    err.textContent = "That file is not JSON.";
    return;
  }
  if (!window.confirm("Import replaces every player and every round with this file.")) return;
  try {
    const response = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      err.textContent = typeof body.detail === "string" ? body.detail : "The course did not answer.";
      return;
    }
    const players = `${body.players} ${body.players === 1 ? "player" : "players"}`;
    const rounds = `${body.rounds} ${body.rounds === 1 ? "round" : "rounds"}`;
    ok.textContent = `Imported ${players} and ${rounds}.`;
    input.value = "";
    await load();
  } catch (_error) {
    err.textContent = "The course did not answer.";
  }
});

load().catch(() => {
  err.textContent = "The course did not answer.";
});
