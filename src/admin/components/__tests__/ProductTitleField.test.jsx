import { render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form } from "../../../components/ui/form";
import ProductTitleField from "../ProductTitleField";

const mockRpc = jest.fn();
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

function Harness({ values, productid }) {
  const form = useForm({ defaultValues: values });
  return (
    <Form {...form}>
      <ProductTitleField form={form} productid={productid} />
    </Form>
  );
}

const values = {
  fabric: "Silk",
  categoryid: "SA",
  title_detail: "Zari Embroidery",
  variants: [{ color: "Blue" }, { color: "Red" }],
};

beforeEach(() => mockRpc.mockReset());

test("asks the database for the title, with every colour", async () => {
  mockRpc.mockResolvedValue({ data: { title: "Silk Saree with Zari Embroidery", duplicate: false }, error: null });
  render(<Harness values={values} productid="BC1" />);
  expect(await screen.findByText("Customers see: Silk Saree with Zari Embroidery")).toBeInTheDocument();
  expect(mockRpc).toHaveBeenCalledWith("preview_product_title", {
    p_fabric: "Silk",
    p_categoryid: "SA",
    p_detail: "Zari Embroidery",
    p_colours: ["Blue", "Red"],
    p_exclude_productid: "BC1",
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("warns about a duplicate title without blocking", async () => {
  mockRpc.mockResolvedValue({ data: { title: "T", duplicate: true }, error: null });
  render(<Harness values={values} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Another product has this title");
});

test("no detail means no preview and no database call", async () => {
  render(<Harness values={{ ...values, title_detail: "" }} />);
  await new Promise((r) => setTimeout(r, 350));
  expect(mockRpc).not.toHaveBeenCalled();
  expect(screen.queryByText(/Customers see/)).not.toBeInTheDocument();
});

test("a failed preview shows nothing and the field still works", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockRpc.mockResolvedValue({ data: null, error: { message: "down" } });
  render(<Harness values={values} />);
  await waitFor(() => expect(mockRpc).toHaveBeenCalled());
  expect(screen.queryByText(/Customers see/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Detail for website title/)).toBeEnabled();
});
