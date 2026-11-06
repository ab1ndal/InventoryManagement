import { generateInvoicePdf } from "../generateInvoicePdf";

const mockAddImage = jest.fn();
const mockJsPdf = jest.fn();

jest.mock("html2canvas", () => () => {
  const canvas = global.document.createElement("canvas");
  canvas.width = 1588;
  canvas.height = 1000;
  return Promise.resolve(canvas);
});

jest.mock("jspdf", () => ({
  jsPDF: function (options) {
    mockJsPdf(options);
    return {
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      addPage: jest.fn(),
      addImage: mockAddImage,
      output: () => new Blob(["pdf"]),
    };
  },
}));

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
  HTMLCanvasElement.prototype.toDataURL = (type) => `data:${type};base64,AAAA`;
});

test("stores pages as compressed JPEG, not raw PNG pixels", async () => {
  await generateInvoicePdf(document.createElement("div"));
  expect(mockJsPdf).toHaveBeenCalledWith(expect.objectContaining({ compress: true }));
  expect(mockAddImage).toHaveBeenCalledTimes(1);
  expect(mockAddImage.mock.calls[0][0]).toMatch(/^data:image\/jpeg/);
  expect(mockAddImage.mock.calls[0][1]).toBe("JPEG");
});
