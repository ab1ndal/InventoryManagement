export default function FiguresDidNotLoad() {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800">
      <p className="font-semibold">Figures did not load</p>
      <p>Sales were not checked, so nothing is shown here. Refresh the page to try again.</p>
    </div>
  );
}
