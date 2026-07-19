const $ = (id) => document.getElementById(id);

function fixed(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function integer(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString();
}

function eth(n, approx = false) {
  if (n === null || n === undefined) return "—";
  return `${approx ? "~" : ""}${fixed(n, 2)} ETH`;
}

function renderSide(prefix, side) {
  $(prefix + "24h").textContent = side.ok === false ? "ERR" : fixed(side.volume24h, 5);
  $(prefix + "Total").textContent = side.totalVolume == null ? "—" : `${fixed(side.totalVolume, 5)} ETH`;
  $(prefix + "Liquidity").textContent = eth(side.liquidityEth, side.liquidityEstimated === true);
  $(prefix + "MarketCap").textContent = eth(side.marketCapEth, false);
  $(prefix + "Holders").textContent = integer(side.holders);
  $(prefix + "Traders").textContent = integer(side.uniqueTraders);
}

function setBattle(data) {
  const green = data?.green || {};
  const blue = data?.blue || {};
  renderSide("green", green);
  renderSide("blue", blue);

  const g = Number(green.volume24h ?? 0);
  const b = Number(blue.volume24h ?? 0);
  const total = g + b;
  const gp = total > 0 ? (g / total) * 100 : 50;
  const bp = 100 - gp;

  $("greenBar").style.width = `${gp}%`;
  $("blueBar").style.width = `${bp}%`;
  $("greenPercent").textContent = `${gp.toFixed(1)}%`;
  $("bluePercent").textContent = `${bp.toFixed(1)}%`;

  if (green.ok !== false && blue.ok !== false) {
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
    $("gap").textContent = `${fixed(Math.abs(g - b), 5)} ETH GAP`;
  } else {
    $("leader").textContent = "PARTIAL DATA";
    $("leader").style.color = "var(--text)";
    $("gap").textContent = "One chain failed to refresh";
  }

  const updated = data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "";
  $("status").textContent =
    green.ok === false || blue.ok === false
      ? `Partial data · ${updated}`
      : `Live on-chain · ${updated} · refresh 30s`;
}

async function refreshBattle() {
  try {
    const res = await fetch("/api/battle", { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    setBattle(await res.json());
  } catch (err) {
    console.error(err);
    $("status").textContent = "On-chain data temporarily unavailable";
  }
}

refreshBattle();
setInterval(refreshBattle, 30000);
