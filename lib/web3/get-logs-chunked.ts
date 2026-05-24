import type { AbiEvent, Address, PublicClient } from "viem";

/// Public RPC endpoints typically reject `eth_getLogs` requests spanning more
/// than ~10K blocks. The vault dashboards need a 24h window (~345K blocks on
/// RBN testnet), so we split the range into chunks and fetch them in parallel.
///
/// Throws on the first failed chunk — callers should NOT swallow the error.
/// React Query's `isError` is the supported channel for surfacing RPC outages
/// to the UI.

const DEFAULT_CHUNK_BLOCKS = 10_000n;
/// Cap parallelism so we don't tip the RPC into a global rate-limit response.
const DEFAULT_CONCURRENCY = 6;

export interface GetLogsChunkedOpts<TEvent extends AbiEvent> {
  client: PublicClient;
  address: Address;
  event: TEvent;
  fromBlock: bigint;
  toBlock: bigint;
  chunkBlocks?: bigint;
  concurrency?: number;
}

export async function getLogsChunked<TEvent extends AbiEvent>({
  client,
  address,
  event,
  fromBlock,
  toBlock,
  chunkBlocks = DEFAULT_CHUNK_BLOCKS,
  concurrency = DEFAULT_CONCURRENCY,
}: GetLogsChunkedOpts<TEvent>) {
  if (toBlock < fromBlock) return [];

  const ranges: { from: bigint; to: bigint }[] = [];
  for (let b = fromBlock; b <= toBlock; b += chunkBlocks) {
    const end = b + chunkBlocks - 1n > toBlock ? toBlock : b + chunkBlocks - 1n;
    ranges.push({ from: b, to: end });
  }

  const results: Awaited<ReturnType<typeof client.getLogs<TEvent>>>[] =
    new Array(ranges.length);

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, ranges.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= ranges.length) return;
        const { from, to } = ranges[i];
        results[i] = await client.getLogs({
          address,
          event,
          fromBlock: from,
          toBlock: to,
        });
      }
    },
  );
  await Promise.all(workers);

  return results.flat();
}
