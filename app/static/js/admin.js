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

function trashButton(attrs, label) {
  return `<button class="trash" type="button" ${attrs} aria-label="${esc(label)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5l1-2zm-1 6h2v10H8V9zm4 0h2v10h-2V9zm4 0h2v10h-2V9zM6 9h12l-1 12H7L6 9z"/></svg></button>`;
}

async function load() {
  showRoster();
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
    rows.innerHTML = `<tr><td colspan="8">No players yet.</td></tr>`;
    return;
  }
  rows.innerHTML = body.players.map((player) => `
    <tr>
      <td class="name">${esc(player.name)}</td>
      <td class="num"><button class="count-link" type="button" data-player="${player.id}" data-name="${esc(player.name)}">${player.rounds_played}</button></td>
      <td>${esc(player.best_label || "—")}</td>
      <td class="num">${player.aces}</td>
      <td class="num">${player.birdies}</td>
      <td>${esc(player.active ? player.active.label : "—")}</td>
      <td>${esc(when(player.last_at))}</td>
      <td class="trash-cell">${trashButton(`data-remove-player="${player.id}"`, "Remove this player")}</td>
    </tr>`).join("");
}

const roster = document.querySelector("#roster");
const detail = document.querySelector("#detail");

function roundsTable(list) {
  if (!list.length) return `<p>No rounds yet.</p>`;
  const body = list.map((round) => `
    <tr class="pick" data-round="${round.id}" tabindex="0">
      <td>${esc(when(round.created_at))}</td>
      <td>${esc(round.label)}</td>
      <td class="num">${round.holes}</td>
      <td class="num">${round.score == null ? "—" : round.score}</td>
      <td class="num">${esc(round.to_par_label || "—")}</td>
      <td class="trash-cell">${trashButton(`data-delete="${round.id}"`, "Remove this round")}</td>
    </tr>`).join("");
  return `
    <p class="hint">Tap a round for the card.</p>
    <div class="table-scroll">
      <table class="card-table">
        <thead><tr><th>When</th><th>Status</th><th class="num">Holes</th><th class="num">Score</th><th class="num">To par</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function showRoster() {
  detail.classList.add("hidden");
  detail.innerHTML = "";
  roster.classList.remove("hidden");
}

function bindRoundRows(playerId, name) {
  detail.querySelectorAll("[data-round]").forEach((row) => {
    const open = () => {
      showCard(playerId, Number(row.dataset.round), name).catch(() => {
        err.textContent = "The course did not answer.";
      });
    };
    row.addEventListener("click", (event) => {
      if (event.target.closest("[data-delete]")) return;
      open();
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("[data-delete]")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    const trash = row.querySelector("[data-delete]");
    trash.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!window.confirm("Are you sure?")) return;
      removeRound(playerId, Number(trash.dataset.delete), name).catch(() => {
        err.textContent = "The course did not answer.";
      });
    });
  });
}

async function removeRound(playerId, roundId, name) {
  err.textContent = "";
  const response = await fetch(`/api/admin/rounds/${roundId}`, { method: "DELETE" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    err.textContent = typeof body.detail === "string" ? body.detail : "The course did not answer.";
    return;
  }
  await showPlayerRounds(playerId, name);
}

async function showPlayerRounds(playerId, name) {
  err.textContent = "";
  ok.textContent = "";
  const response = await fetch(`/api/players/${playerId}/rounds`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    err.textContent = typeof body.detail === "string" ? body.detail : "The course did not answer.";
    return;
  }
  roster.classList.add("hidden");
  detail.classList.remove("hidden");
  detail.innerHTML = `
    <h2>${esc(name)}</h2>
    ${roundsTable(body.rounds || [])}
    <button class="quiet" id="rounds-back" type="button">Players</button>`;
  detail.querySelector("#rounds-back").addEventListener("click", () => {
    load().catch(() => {
      err.textContent = "The course did not answer.";
    });
  });
  bindRoundRows(playerId, name);
}

async function showCard(playerId, roundId, name) {
  err.textContent = "";
  const response = await fetch(`/api/rounds/${roundId}/card?player_id=${playerId}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    err.textContent = typeof body.detail === "string" ? body.detail : "The course did not answer.";
    return;
  }
  const cardRows = (body.card || []).map((row) => `
    <tr>
      <td>${row.number}</td>
      <td>${esc(row.name)}</td>
      <td class="num">${row.par}</td>
      <td class="num">${row.score == null ? "" : row.score}</td>
    </tr>`).join("");
  detail.innerHTML = `
    <p class="eyebrow">${esc(when(body.created_at))} · ${esc(body.label)}</p>
    <h2>${esc(body.to_par_label)} · ${esc(name)}</h2>
    <p>${body.total_strokes} throws through ${body.holes_played} holes. Par ${body.par_total}.</p>
    <div class="table-scroll">
      <table class="card-table">
        <thead><tr><th>#</th><th>Hole</th><th class="num">Par</th><th class="num">You</th></tr></thead>
        <tbody>${cardRows}</tbody>
      </table>
    </div>
    <button class="quiet" id="card-back" type="button">Rounds</button>`;
  detail.querySelector("#card-back").addEventListener("click", () => {
    showPlayerRounds(playerId, name).catch(() => {
      err.textContent = "The course did not answer.";
    });
  });
}

async function removePlayer(playerId) {
  err.textContent = "";
  ok.textContent = "";
  const response = await fetch(`/api/players/${playerId}`, { method: "DELETE" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    err.textContent = typeof body.detail === "string" ? body.detail : "The course did not answer.";
    return;
  }
  await load();
}

rows.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-player]");
  if (remove) {
    if (!window.confirm("Are you sure?")) return;
    removePlayer(Number(remove.dataset.removePlayer)).catch(() => {
      err.textContent = "The course did not answer.";
    });
    return;
  }
  const button = event.target.closest("[data-player]");
  if (!button) return;
  showPlayerRounds(Number(button.dataset.player), button.dataset.name).catch(() => {
    err.textContent = "The course did not answer.";
  });
});

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
