import { listSalespersons } from "../salespersons";
import { fakeSupabase } from "../testing/fakeSupabase";

describe("listSalespersons", () => {
  it("returns id, name and active flag", async () => {
    const rows = [{ salesperson_id: 10, name: "Asha", active: true }];
    const client = fakeSupabase({ "salespersons.select": { data: rows, error: null } });
    await expect(listSalespersons(client)).resolves.toEqual(rows);
  });

  it("passes a database error on", async () => {
    const client = fakeSupabase({ "salespersons.select": { data: null, error: new Error("db down") } });
    await expect(listSalespersons(client)).rejects.toThrow("db down");
  });
});
