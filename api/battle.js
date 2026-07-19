import {
  JsonRpcProvider,
  Contract,
  Interface,
  formatEther,
  formatUnits
} from "ethers";

export const config = { maxDuration: 60 };

const DAY = 24 * 60 * 60;
const ZERO_TOPIC = "0x" + "0".repeat(64);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
];

const V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
];

const V4_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
  "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
];

const erc20Iface = new Interface(ERC20_ABI);
const v3Iface = new Interface(V3_POOL_ABI);
const v4Iface = new Interface(V4_MANAGER_ABI);

function lower(x) {
  return String(x).toLowerCase();
}

function absBigInt(x) {
  return x < 0n ? -x : x;
}

function rawPriceFromSqrtX96(sqrtX96) {
  const sqrt = Number(sqrtX96) / 2 ** 96;
  return sqrt * sqrt;
}

async function getLogsAdaptive(provider, filter, fromBlock, toBlock, maxSpan = 50000) {
  const out = [];
  async function run(start, end) {
    if (start > end) return;
    if (end - start > maxSpan) {
      const mid = start + maxSpan;
      await run(start, mid);
      await run(mid + 1, end);
      return;
    }
    try {
      out.push(...await provider.getLogs({ ...filter, fromBlock: start, toBlock: end }));
    } catch (err) {
      if (end - start <= 250) throw err;
      const mid = Math.floor((start + end) / 2);
      await run(start, mid);
      await run(mid + 1, end);
    }
  }
  await run(fromBlock, toBlock);
  return out;
}

async function findMintBlock(provider, token, latest) {
  const transferTopic = erc20Iface.getEvent("Transfer").topicHash;
  const step = 50000;
  const maxLookback = 5000000;
  let scanned = 0;
  let end = latest;

  while (end >= 0 && scanned < maxLookback) {
    const start = Math.max(0, end - step + 1);
    const logs = await getLogsAdaptive(
      provider,
      { address: token, topics: [transferTopic, ZERO_TOPIC] },
      start,
      end,
      10000
    );
    if (logs.length) {
      return Math.min(...logs.map((l) => l.blockNumber));
    }
    scanned += end - start + 1;
    if (start === 0) break;
    end = start - 1;
  }
  throw new Error("Token mint block not found in recent history");
}

async function findFirstBlockAtOrAfter(provider, targetTimestamp, initialLookback) {
  const latestNumber = await provider.getBlockNumber();
  const latest = await provider.getBlock(latestNumber);
  if (!latest) throw new Error("Could not read latest block");

  let hi = latestNumber;
  let lo = Math.max(0, latestNumber - initialLookback);
  let loBlock = await provider.getBlock(lo);
  if (!loBlock) throw new Error("Could not read lookback block");

  let span = initialLookback;
  while (lo > 0 && Number(loBlock.timestamp) > targetTimestamp) {
    hi = lo;
    span *= 2;
    lo = Math.max(0, latestNumber - span);
    loBlock = await provider.getBlock(lo);
    if (!loBlock) throw new Error("Could not expand timestamp search");
  }

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const block = await provider.getBlock(mid);
    if (!block) throw new Error(`Could not read block ${mid}`);
    if (Number(block.timestamp) < targetTimestamp) lo = mid;
    else hi = mid;
  }
  return hi;
}

function countHolders(transferLogs) {
  const balances = new Map();

  for (const log of transferLogs) {
    const parsed = erc20Iface.parseLog(log);
    const from = lower(parsed.args.from);
    const to = lower(parsed.args.to);
    const value = BigInt(parsed.args.value);

    if (from !== ZERO_ADDRESS) {
      balances.set(from, (balances.get(from) || 0n) - value);
    }
    if (to !== ZERO_ADDRESS) {
      balances.set(to, (balances.get(to) || 0n) + value);
    }
  }

  let count = 0;
  for (const balance of balances.values()) {
    if (balance > 0n) count++;
  }
  return count;
}

async function countUniqueTransactionSenders(provider, swapLogs) {
  const hashes = [...new Set(swapLogs.map((l) => l.transactionHash))];
  const senders = new Set();
  const batchSize = 15;

  for (let i = 0; i < hashes.length; i += batchSize) {
    const batch = hashes.slice(i, i + batchSize);
    const txs = await Promise.all(batch.map((h) => provider.getTransaction(h)));
    for (const tx of txs) {
      if (tx?.from) senders.add(lower(tx.from));
    }
  }
  return senders.size;
}

function sumV3EthVolume(logs, ethIndex) {
  let wei = 0n;
  for (const log of logs) {
    const parsed = v3Iface.parseLog(log);
    const amount = ethIndex === 0 ? parsed.args.amount0 : parsed.args.amount1;
    wei += absBigInt(BigInt(amount));
  }
  return Number(formatEther(wei));
}

function sumV4EthVolume(logs) {
  let wei = 0n;
  for (const log of logs) {
    const parsed = v4Iface.parseLog(log);
    // BlueBase pool is native ETH (currency0) / BBASE (currency1).
    wei += absBigInt(BigInt(parsed.args.amount0));
  }
  return Number(formatEther(wei));
}

function reconstructV4LiquidityEth(modifyLogs, sqrtPriceX96, tokenDecimals, priceEthPerToken) {
  // Reconstructs principal liquidity from ModifyLiquidity events.
  // This does not include uncollected fees, so the UI marks it as an estimate.
  const ranges = new Map();

  for (const log of modifyLogs) {
    const p = v4Iface.parseLog(log);
    const key = `${p.args.tickLower}:${p.args.tickUpper}`;
    ranges.set(key, (ranges.get(key) || 0n) + BigInt(p.args.liquidityDelta));
  }

  const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
  let amount0Raw = 0;
  let amount1Raw = 0;

  for (const [key, liquidityBig] of ranges.entries()) {
    if (liquidityBig <= 0n) continue;
    const [tickLower, tickUpper] = key.split(":").map(Number);
    const sqrtA = Math.pow(1.0001, tickLower / 2);
    const sqrtB = Math.pow(1.0001, tickUpper / 2);
    const L = Number(liquidityBig);

    if (sqrtP <= sqrtA) {
      amount0Raw += L * (sqrtB - sqrtA) / (sqrtA * sqrtB);
    } else if (sqrtP < sqrtB) {
      amount0Raw += L * (sqrtB - sqrtP) / (sqrtP * sqrtB);
      amount1Raw += L * (sqrtP - sqrtA);
    } else {
      amount1Raw += L * (sqrtB - sqrtA);
    }
  }

  const amount0Eth = amount0Raw / 1e18;
  const amount1Token = amount1Raw / 10 ** tokenDecimals;
  return amount0Eth + amount1Token * priceEthPerToken;
}

async function greenStats() {
  const provider = new JsonRpcProvider(GREEN.rpc, 4663, { staticNetwork: true });
  const latest = await provider.getBlockNumber();
  const mintBlock = await findMintBlock(provider, GREEN.token, latest);
  const cutoff = Math.floor(Date.now() / 1000) - DAY;
  const from24h = Math.max(
    mintBlock,
    await findFirstBlockAtOrAfter(provider, cutoff, 500000)
  );

  const pool = new Contract(GREEN.pool, V3_POOL_ABI, provider);
  const token = new Contract(GREEN.token, ERC20_ABI, provider);

  const [token0, token1, slot0, tokenDecimals, totalSupplyRaw] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.slot0(),
    token.decimals(),
    token.totalSupply(),
  ]);

  let ethIndex;
  let ethTokenAddress;
  if (lower(token0) === lower(GREEN.token)) {
    ethIndex = 1;
    ethTokenAddress = token1;
  } else if (lower(token1) === lower(GREEN.token)) {
    ethIndex = 0;
    ethTokenAddress = token0;
  } else {
    throw new Error("GreenHood token is not in configured V3 pool");
  }

  const ethToken = new Contract(ethTokenAddress, ERC20_ABI, provider);
  const [ethDecimals, tokenBalRaw, ethBalRaw] = await Promise.all([
    ethToken.decimals(),
    token.balanceOf(GREEN.pool),
    ethToken.balanceOf(GREEN.pool),
  ]);

  const swapTopic = v3Iface.getEvent("Swap").topicHash;
  const transferTopic = erc20Iface.getEvent("Transfer").topicHash;

  const [allSwaps, swaps24h, transfers] = await Promise.all([
    getLogsAdaptive(provider, { address: GREEN.pool, topics: [swapTopic] }, mintBlock, latest),
    getLogsAdaptive(provider, { address: GREEN.pool, topics: [swapTopic] }, from24h, latest),
    getLogsAdaptive(provider, { address: GREEN.token, topics: [transferTopic] }, mintBlock, latest),
  ]);

  const rawRatio = rawPriceFromSqrtX96(slot0.sqrtPriceX96);
  const decimalFactor = 10 ** (Number(tokenDecimals) - Number(ethDecimals));
  const priceEthPerToken =
    ethIndex === 1 ? rawRatio * decimalFactor : (1 / rawRatio) * decimalFactor;

  const supply = Number(formatUnits(totalSupplyRaw, tokenDecimals));
  const tokenBalance = Number(formatUnits(tokenBalRaw, tokenDecimals));
  const ethBalance = Number(formatUnits(ethBalRaw, ethDecimals));

  return {
    ok: true,
    volume24h: sumV3EthVolume(swaps24h, ethIndex),
    totalVolume: sumV3EthVolume(allSwaps, ethIndex),
    liquidityEth: ethBalance + tokenBalance * priceEthPerToken,
    liquidityEstimated: false,
    marketCapEth: supply * priceEthPerToken,
    holders: countHolders(transfers),
    uniqueTraders: await countUniqueTransactionSenders(provider, allSwaps),
    mintBlock,
  };
}

async function blueStats() {
  const provider = new JsonRpcProvider(BLUE.rpc, 8453, { staticNetwork: true });
  const latest = await provider.getBlockNumber();
  const mintBlock = await findMintBlock(provider, BLUE.token, latest);
  const cutoff = Math.floor(Date.now() / 1000) - DAY;
  const from24h = Math.max(
    mintBlock,
    await findFirstBlockAtOrAfter(provider, cutoff, 70000)
  );

  const token = new Contract(BLUE.token, ERC20_ABI, provider);
  const [tokenDecimals, totalSupplyRaw] = await Promise.all([
    token.decimals(),
    token.totalSupply(),
  ]);

  const swapTopic = v4Iface.getEvent("Swap").topicHash;
  const modifyTopic = v4Iface.getEvent("ModifyLiquidity").topicHash;
  const transferTopic = erc20Iface.getEvent("Transfer").topicHash;

  const [allSwaps, swaps24h, modifyLogs, transfers] = await Promise.all([
    getLogsAdaptive(
      provider,
      { address: BLUE.poolManager, topics: [swapTopic, BLUE.poolId] },
      mintBlock,
      latest
    ),
    getLogsAdaptive(
      provider,
      { address: BLUE.poolManager, topics: [swapTopic, BLUE.poolId] },
      from24h,
      latest
    ),
    getLogsAdaptive(
      provider,
      { address: BLUE.poolManager, topics: [modifyTopic, BLUE.poolId] },
      mintBlock,
      latest
    ),
    getLogsAdaptive(
      provider,
      { address: BLUE.token, topics: [transferTopic] },
      mintBlock,
      latest
    ),
  ]);

  if (!allSwaps.length) throw new Error("No BlueBase swaps found");

  const latestSwap = v4Iface.parseLog(allSwaps[allSwaps.length - 1]);
  const rawTokenPerEth = rawPriceFromSqrtX96(latestSwap.args.sqrtPriceX96);
  const humanTokenPerEth =
    rawTokenPerEth * 10 ** (18 - Number(tokenDecimals));
  const priceEthPerToken = 1 / humanTokenPerEth;

  const supply = Number(formatUnits(totalSupplyRaw, tokenDecimals));
  const liquidityEth = reconstructV4LiquidityEth(
    modifyLogs,
    latestSwap.args.sqrtPriceX96,
    Number(tokenDecimals),
    priceEthPerToken
  );

  return {
    ok: true,
    volume24h: sumV4EthVolume(swaps24h),
    totalVolume: sumV4EthVolume(allSwaps),
    liquidityEth,
    liquidityEstimated: true,
    marketCapEth: supply * priceEthPerToken,
    holders: countHolders(transfers),
    uniqueTraders: await countUniqueTransactionSenders(provider, allSwaps),
    mintBlock,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

  const [g, b] = await Promise.allSettled([greenStats(), blueStats()]);

  const green =
    g.status === "fulfilled"
      ? g.value
      : {
          ok: false,
          volume24h: 0,
          totalVolume: null,
          liquidityEth: null,
          marketCapEth: null,
          holders: null,
          uniqueTraders: null,
          error: g.reason?.message || "Green data error",
        };

  const blue =
    b.status === "fulfilled"
      ? b.value
      : {
          ok: false,
          volume24h: 0,
          totalVolume: null,
          liquidityEth: null,
          marketCapEth: null,
          holders: null,
          uniqueTraders: null,
          error: b.reason?.message || "Blue data error",
        };

  res.status(200).json({
    updatedAt: new Date().toISOString(),
    definitions: {
      totalVolume: "Cumulative ETH-side swap volume since token mint",
      liquidity: "Pool value expressed in ETH; BlueBase is estimated principal liquidity excluding uncollected fees",
      marketCap: "Total supply multiplied by current pool price, expressed in ETH",
      holders: "Addresses with a positive token balance reconstructed from Transfer events",
      uniqueTraders: "Unique transaction-origin addresses across all pool swaps",
    },
    green,
    blue,
  });
}
