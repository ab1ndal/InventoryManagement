import { retryAfterReload } from "../lazyWithReload";

const reload = jest.fn();
const realLocation = window.location;

beforeAll(() => {
  delete window.location;
  window.location = { ...realLocation, reload };
});

afterAll(() => {
  window.location = realLocation;
});

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a successful load returns the module without reloading", async () => {
  const module = { default: "Page" };
  await expect(retryAfterReload(() => Promise.resolve(module))).resolves.toBe(module);
  expect(reload).not.toHaveBeenCalled();
});

test("the first failure reloads the page and never settles", async () => {
  const settled = jest.fn();
  retryAfterReload(() => Promise.reject(new Error("chunk gone"))).then(settled, settled);
  await flush();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(settled).not.toHaveBeenCalled();
});

test("a failure after that reload is thrown, so it cannot loop", async () => {
  sessionStorage.setItem("chunk_reload_attempted", "1");
  const load = () => Promise.reject(new Error("chunk gone"));
  await expect(retryAfterReload(load)).rejects.toThrow("chunk gone");
  expect(reload).not.toHaveBeenCalled();
});

test("a success clears the attempt, so a later deploy can reload again", async () => {
  sessionStorage.setItem("chunk_reload_attempted", "1");
  await retryAfterReload(() => Promise.resolve({}));
  expect(sessionStorage.getItem("chunk_reload_attempted")).toBeNull();
});
