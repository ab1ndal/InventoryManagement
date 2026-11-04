import { fetchInChunks } from "../fetchInChunks";

const ids = (count) => Array.from({ length: count }, (_, i) => `id-${i}`);

test("700 ids are fetched in chunks of 300 and every row comes back", async () => {
  const sizes = [];
  const rows = await fetchInChunks(ids(700), async (chunk) => {
    sizes.push(chunk.length);
    return { data: chunk.map((id) => ({ id })), error: null };
  });

  expect(sizes).toEqual([300, 300, 100]);
  expect(rows.map((r) => r.id)).toEqual(ids(700));
});

test("no ids means no request", async () => {
  const makeQuery = jest.fn();
  expect(await fetchInChunks([], makeQuery)).toEqual([]);
  expect(makeQuery).not.toHaveBeenCalled();
});

test("one failed chunk fails the whole fetch instead of returning part of the answer", async () => {
  const failure = { message: "400 Bad Request" };
  let call = 0;
  const makeQuery = async (chunk) => {
    call += 1;
    return call === 2 ? { data: null, error: failure } : { data: chunk, error: null };
  };

  await expect(fetchInChunks(ids(700), makeQuery)).rejects.toBe(failure);
});
