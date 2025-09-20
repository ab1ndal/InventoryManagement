import { Textarea } from "../../../components/ui/textarea";
import { Label } from "../../../components/ui/label";

export default function Notes({ notes, setNotes }) {
  return (
    <section className="grid gap-2">
      <Label>Notes</Label>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Special instructions..."
      />
    </section>
  );
}
