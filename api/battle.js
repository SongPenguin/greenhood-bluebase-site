import { JsonRpcProvider, Contract, Interface, formatEther } from "ethers";

export const config = { maxDuration: 60 };

const GREEN = {
  rpc: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  token: "0x2774570eac3F633460dFD2bBA14fb08CabF24663",
  pool: "0xe436aACf983A3C1323ECD2641F8f956Ad8f5bde1",
};

const BLUE = {
  rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  token: "0xB20000000000000000000078118fD5c63cDa3e01",
  poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
  poolId: "0x4F12EB8FCE0134F3901424915741EAE32100A0A611F5504F40D4562251D0A2D7",
};

const V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
];

const V4_MANAGER_ABI = [
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
];

const v3Iface = new Interface(V3_POOL_ABI);
const v4Iface = new Interface(V4_MANAGER_ABI);

const DAY = 24 * 60 * 60;

function lower(x) {
  return String(x).toLowerCase();
}

function absBigInt(x) {
  return x < 0n ? -x : x;
}

async function findFirstBlockAtOrAfter(provider, targetTimestamp, initialLookback) {
  const latestNumber = await provider.getBlockNumber();
  const latest = await provider.getBlock(latestNumber);
  if (!latest) throw new Error("Could not read latest block");

  let hi = latestNumber;
  let lo = Math.max(0, latestNumber - initialLookback);
  let loBlock = await provider.getBlock(lo);
  if (!loBlock) throw new Error("Could not read lookback block");

  // If the initial window is shorter than 24h, expand backward.
  let span = initialLookback;
  while (lo > 0 && Number(loBlock.timestamp) > targetTimestamp) {
    hi = lo;
    span *= 2;
    lo = Math.max(0, latestNumber - span);
    loBlock = await provider.getBlock(lo);
    if (!loBlock) throw new Error("Could not expand block search");
  }

  // Binary-search the first block whose timestamp is >= target.
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const block = await provider.getBlock(mid);
    if (!block) throw new Error(`Could not read block ${mid}`);
    if (Number(block.timestamp) < targetTimestamp) lo = mid;
    else hi = mid;
  }
  return hi;
}

async function getLogsAdaptive(provider, filter, fromBlock, toBlock, maxSpan = 100000) {
  const out = [];

  async function fetchRange(start, end) {
    if (start > end) return;
    if (end - start > maxSpan) {
      const mid = start + maxSpan;
      await fetchRange(start, mid);
      await fetchRange(mid + 1, end);
      return;
    }
    try {
      const logs = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      out.push(...logs);
    } catch (err) {
      const width = end - start;
      if (width <= 500) throw err;
      const mid = Math.floor((start + end) / 2);
      await fetchRange(start, mid);
      await fetchRange(mid + 1, end);
    }
  }

  await fetchRange(fromBlock, toBlock);
  return out;
}

async function greenVolume24h() {
  const provider = new JsonRpcProvider(GREEN.rpc, 4663, { staticNetwork: true });
  const pool = new Contract(GREEN.pool, V3_POOL_ABI, provider);

  const [token0, token1, latest] = await Promise.all([
    pool.token0(),
    pool.token1(),
    provider.getBlockNumber(),
  ]);

  let ethIndex;
  if (lower(token0) === lower(GREEN.token)) ethIndex = 1;
  else if (lower(token1) === lower(GREEN.token)) ethIndex = 0;
  else throw new Error("GreenHood token is not in configured V3 pool");

  const cutoff = Math.floor(Date.now() / 1000) - DAY;
  // Robinhood Chain is Arbitrum-based and can produce many L2 blocks per day.
  const fromBlock = await findFirstBlockAtOrAfter(provider, cutoff, 500000);

  const event = v3Iface.getEvent("Swap");
  const logs = await getLogsAdaptive(
    provider,
    { address: GREEN.pool, topics: [event.topicHash] },
    fromBlock,
    latest
  );

  let wei = 0n;
  for (const log of logs) {
    const parsed = v3Iface.parseLog(log);
    const amount = ethIndex === 0 ? parsed.args.amount0 : parsed.args.amount1;
    wei += absBigInt(amount);
  }

  return Number(formatEther(wei));
}

async function blueVolume24h() {
  const provider = new JsonRpcProvider(BLUE.rpc, 8453, { staticNetwork: true });
  const latest = await provider.getBlockNumber();
  const cutoff = Math.floor(Date.now() / 1000) - DAY;
  const fromBlock = await findFirstBlockAtOrAfter(provider, cutoff, 70000);

  const event = v4Iface.getEvent("Swap");
  const logs = await getLogsAdaptive(
    provider,
    {
      address: BLUE.poolManager,
      topics: [event.topicHash, BLUE.poolId],
    },
    fromBlock,
    latest
  );

  // This BBASE pool is native ETH (currency0) / BBASE (currency1).
  // In Uniswap v4, native currency is address(0), which sorts before any ERC-20 address.
  let wei = 0n;
  for (const log of logs) {
    const parsed = v4Iface.parseLog(log);
    wei += absBigInt(parsed.args.amount0);
  }

  return Number(formatEther(wei));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

  const [greenResult, blueResult] = await Promise.allSettled([
    greenVolume24h(),
    blueVolume24h(),
  ]);

  const green =
    greenResult.status === "fulfilled"
      ? { ok: true, volume24h: greenResult.value, totalVolume: null }
      : { ok: false, volume24h: 0, totalVolume: null, error: greenResult.reason?.message || "Green RPC error" };

  const blue =
    blueResult.status === "fulfilled"
      ? { ok: true, volume24h: blueResult.value, totalVolume: null }
      : { ok: false, volume24h: 0, totalVolume: null, error: blueResult.reason?.message || "Blue RPC error" };

  res.status(200).json({
    updatedAt: new Date().toISOString(),
    green,
    blue,
  });
}
