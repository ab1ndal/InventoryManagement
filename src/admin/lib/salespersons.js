// src/admin/lib/salespersons.js
// Salesperson lookup shared by the admin CLI. The billing screen offers only
// active salespersons (billingLookups.loadActiveSalespeople); the list shows
// every one with its active flag so a spec writer sees why a name is refused.
// salary is never read.

export async function listSalespersons(client) {
  const { data, error } = await client
    .from("salespersons")
    .select("salesperson_id, name, active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}
