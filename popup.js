const form = document.querySelector("#search-form");
const input = document.querySelector("#player-input");
const statusBox = document.querySelector("#status");
const result = document.querySelector("#result");
const avatar = document.querySelector("#avatar");
const playerName = document.querySelector("#player-name");
const profileMeta = document.querySelector("#profile-meta");
const statsGrid = document.querySelector("#stats-grid");
const favoriteToggle = document.querySelector("#favorite-toggle");
const favoriteWrap = document.querySelector("#favorite-wrap");
const favoriteList = document.querySelector("#favorite-list");
const clearFavorites = document.querySelector("#clear-favorites");
const recentWrap = document.querySelector("#recent-wrap");
const recentList = document.querySelector("#recent-list");
const clearRecent = document.querySelector("#clear-recent");

const RECENT_KEY = "recentPlayers";
const FAVORITE_KEY = "favoritePlayers";
const STAT_ORDER = [
  "Money",
  "Shards",
  "Playtime",
  "Kills",
  "Deaths",
  "Mobs killed",
  "Blocks broken",
  "Blocks placed",
  "Earned /sell",
  "Spent /shop"
];

let activePlayer = "";

document.addEventListener("DOMContentLoaded", async () => {
  input.focus();
  await renderFavorites();
  await renderRecent();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = sanitizeUsername(input.value);

  if (!username) {
    hideResult();
    showStatus("Enter a Minecraft username first.", true);
    return;
  }

  await searchPlayer(username);
});

input.addEventListener("input", () => {
  if (!sanitizeUsername(input.value)) {
    hideResult();
    hideStatus();
  }
});

clearRecent.addEventListener("click", async () => {
  await chrome.storage.local.set({ [RECENT_KEY]: [] });
  await renderRecent();
});

clearFavorites.addEventListener("click", async () => {
  await chrome.storage.local.set({ [FAVORITE_KEY]: [] });
  await renderFavorites();
  await updateFavoriteToggle();
});

favoriteToggle.addEventListener("click", async () => {
  if (!activePlayer) {
    return;
  }

  await toggleFavorite(activePlayer);
  await renderFavorites();
  await updateFavoriteToggle();
});

async function searchPlayer(username) {
  setLoading(true);
  hideResult();
  showStatus(`Searching ${username}...`);

  try {
    const response = await fetch(playerUrl(username), {
      credentials: "omit",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`DonutStats returned ${response.status}.`);
    }

    const html = await response.text();
    const player = parsePlayerPage(html, username);

    if (!player.stats.length) {
      throw new Error("No player stats were found for that name.");
    }

    activePlayer = player.name;
    renderPlayer(player);
    hideStatus();
    await rememberPlayer(player.name);
    await updateFavoriteToggle();
    await renderFavorites();
    await renderRecent();
  } catch (error) {
    showStatus(`${error.message} Try opening the full profile if the player exists but has not loaded yet.`, true);
  } finally {
    setLoading(false);
  }
}

function parsePlayerPage(html, fallbackName) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const titleName = doc.querySelector("h1 span")?.textContent?.trim();
  const headingName = doc.querySelector("h1")?.textContent?.trim();
  const name = titleName || headingName || fallbackName;

  const metaPieces = [...doc.querySelectorAll("a, span")]
    .map((node) => node.textContent.trim())
    .filter((text) => /vouches|profile views/i.test(text));

  const statCards = [...doc.querySelectorAll("div")]
    .map((card) => {
      const label = card.querySelector("span.text-xs")?.textContent?.trim();
      const value = card.querySelector("span.font-mono")?.textContent?.trim();
      return label && value ? { label, value } : null;
    })
    .filter(Boolean);

  const dedupedStats = [];
  const seen = new Set();
  for (const stat of statCards) {
    const key = stat.label.toLowerCase();
    if (!seen.has(key)) {
      dedupedStats.push(stat);
      seen.add(key);
    }
  }

  dedupedStats.sort((a, b) => {
    const aIndex = STAT_ORDER.indexOf(a.label);
    const bIndex = STAT_ORDER.indexOf(b.label);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  return {
    name,
    meta: [...new Set(metaPieces)].slice(0, 2).join(" • "),
    stats: dedupedStats.slice(0, 10)
  };
}

function renderPlayer(player) {
  result.hidden = false;
  playerName.textContent = player.name;
  profileMeta.textContent = player.meta || "DonutSMP player profile";
  avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/112`;
  avatar.alt = `${player.name} avatar`;

  statsGrid.replaceChildren(
    ...player.stats.map((stat) => {
      const item = document.createElement("article");
      item.className = "stat";

      const label = document.createElement("span");
      label.className = "stat-label";
      label.textContent = stat.label;

      const value = document.createElement("span");
      value.className = "stat-value";
      value.textContent = stat.value;

      item.append(label, value);
      return item;
    })
  );
}

async function renderFavorites() {
  const favorites = await getFavorites();
  favoriteWrap.hidden = favorites.length === 0;
  favoriteList.replaceChildren(
    ...favorites.map((name) => createAccountChip(name, "account-chip favorite-chip"))
  );
}

async function renderRecent() {
  const recent = await getRecent();
  recentWrap.hidden = recent.length === 0;
  recentList.replaceChildren(
    ...recent.map((name) => createAccountChip(name, "account-chip"))
  );
}

function createAccountChip(name, className) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = className;
  chip.textContent = name;
  chip.addEventListener("click", () => {
    input.value = name;
    searchPlayer(name);
  });
  return chip;
}

async function rememberPlayer(username) {
  const recent = await getRecent();
  const next = [username, ...recent.filter((name) => name.toLowerCase() !== username.toLowerCase())].slice(0, 8);
  await chrome.storage.local.set({ [RECENT_KEY]: next });
}

async function toggleFavorite(username) {
  const favorites = await getFavorites();
  const isSaved = favorites.some((name) => name.toLowerCase() === username.toLowerCase());
  const next = isSaved
    ? favorites.filter((name) => name.toLowerCase() !== username.toLowerCase())
    : [username, ...favorites].slice(0, 12);

  await chrome.storage.local.set({ [FAVORITE_KEY]: next });
}

async function updateFavoriteToggle() {
  const favorites = await getFavorites();
  const isSaved = activePlayer && favorites.some((name) => name.toLowerCase() === activePlayer.toLowerCase());
  favoriteToggle.classList.toggle("is-favorite", Boolean(isSaved));
  favoriteToggle.title = isSaved ? "Remove favorite" : "Add favorite";
  favoriteToggle.setAttribute("aria-label", isSaved ? "Remove favorite" : "Add favorite");
}

async function getRecent() {
  const data = await chrome.storage.local.get(RECENT_KEY);
  return Array.isArray(data[RECENT_KEY]) ? data[RECENT_KEY] : [];
}

async function getFavorites() {
  const data = await chrome.storage.local.get(FAVORITE_KEY);
  return Array.isArray(data[FAVORITE_KEY]) ? data[FAVORITE_KEY] : [];
}

function setLoading(isLoading) {
  form.querySelector("button").disabled = isLoading;
  input.disabled = isLoading;
}

function showStatus(message, isError = false) {
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function hideStatus() {
  statusBox.hidden = true;
  statusBox.textContent = "";
  statusBox.classList.remove("error");
}

function hideResult() {
  result.hidden = true;
  activePlayer = "";
  favoriteToggle.classList.remove("is-favorite");
  statsGrid.replaceChildren();
}

function sanitizeUsername(value) {
  return value.trim().replace(/\s+/g, "");
}

function playerUrl(username) {
  return `https://donutstats.org/player.php?user=${encodeURIComponent(username)}`;
}
