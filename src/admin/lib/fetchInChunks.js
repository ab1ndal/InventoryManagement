// A long id list makes the request URL too long, and the server then refuses it.
// About 640 UUIDs was measured as the limit, so this stays well under it.
// Stopgap: totals for a period should later be added up on the server instead of fetching costs per id.
export const ID_CHUNK_SIZE = 300;

// makeQuery(chunk) must return a fresh query. Any failed chunk throws, so a caller can
// never mistake a partial result for the whole answer.
export async function fetchInChunks(ids, makeQuery, chunkSize = ID_CHUNK_SIZE) {
  const rows = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    const { data, error } = await makeQuery(ids.slice(start, start + chunkSize));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}
