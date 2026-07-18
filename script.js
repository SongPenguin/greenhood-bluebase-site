const $ = (id) => document.getElementById(id);

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setBattle(data) {
  const g = Number(data?.green?.volume24h ?? 0);
  const b = Number(data?.blue?.volume24h ?? 0);
  const greenOk = data?.green?.ok !== false;
  const blueOk = data?.blue?.ok !== false;

  $("green24h").textContent = greenOk ? fmt(g) : "ERR";
  $("blue24h").textContent = blueOk ? fmt(b) : "ERR";

  // All-time total is intentionally left blank until launch blocks are configured.
  $("greenTotal").textContent = data?.green?.totalVolume == null ? "—" : `${fmt(data.green.totalVolume)} ETH`;
  $("blueTotal").textContent = data?.blue?.totalVolume == null ? "—" : `${fmt(data.blue.totalVolume)} ETH`;

  const total = g + b;
  const gp = total > 0 ? (g / total) * 100 : 50;
  const bp = 100 - gp;
  $("greenBar").style.width = `${gp}%`;
  $("blueBar").style.width = `${bp}%`;
  $("greenPercent").textContent = `${gp.toFixed(1)}%`;
  $("bluePercent").textContent = `${bp.toFixed(1)}%`;

  if (greenOk && blueOk) {
    if (g > b) {
      $("leader").textContent = "GREENHOOD";
      $("leader").style.color = "var(--green)";
    } else if (b > g) {
      $("leader").textContent = "BLUEBASE";
      $("leader").style.color = "var(--blue)";
    } else {
      $("leader").textContent = "DRAW";
      $("leader").style.color = "var(--text)";
    }
    $("gap").textContent = `${fmt(Math.abs(g - b))} ETH GAP`;
  } else {
    $("leader").textContent = "PARTIAL DATA";
    $("leader").style.color = "var(--text)";
    $("gap").textContent = "One chain failed to refresh";
  }

  const updated = data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "";
  const errors = [data?.green?.error, data?.blue?.error].filter(Boolean);
  $("status").textContent = errors.length
    ? `Partial data · ${updated}`
    : `Live on-chain · ${updated} · refresh 30s`;
}

async function refreshBattle() {
  try {
    const res = await fetch("/api/battle", { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    setBattle(data);
  } catch (err) {
    console.error(err);
    $("status").textContent = "On-chain data temporarily unavailable";
  }
}

refreshBattle();
setInterval(refreshBattle, 30000);
