import { formatRange } from "@/lib/time";
import type { PollBundle, SlotTally } from "@/lib/types";

const MARK: Record<string, { text: string; className: string }> = {
  yes: { text: "○", className: "text-emerald-600" },
  maybe: { text: "△", className: "text-amber-600" },
  no: { text: "×", className: "text-rose-500" },
};

interface Props {
  bundle: PollBundle;
  tallies: SlotTally[];
  /** 最有力の候補を目立たせる（同点なら先頭のみ）。 */
  highlightSlotId?: string | null;
}

export default function ResultTable({ bundle, tallies, highlightSlotId }: Props) {
  const { poll, slots, participants, votes } = bundle;
  const answerOf = new Map(votes.map((v) => [`${v.participantId}:${v.slotId}`, v.answer]));
  const tallyOf = new Map(tallies.map((t) => [t.slot.id, t]));

  return (
    <div className="table-scroll rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600">
              候補日時
            </th>
            <th className="px-3 py-2 text-center font-medium text-slate-600">集計</th>
            {participants.map((p) => (
              <th key={p.id} className="px-3 py-2 text-center font-medium text-slate-600">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => {
            const t = tallyOf.get(slot.id);
            const isTop = highlightSlotId === slot.id;
            return (
              <tr
                key={slot.id}
                className={`border-b border-slate-100 last:border-0 ${isTop ? "bg-brand-50" : ""}`}
              >
                <td
                  className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 tabular-nums ${
                    isTop ? "bg-brand-50 font-medium text-brand-700" : "bg-white text-slate-700"
                  }`}
                >
                  {formatRange(slot.startsAt, slot.endsAt, poll.timezone)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-xs text-slate-500">
                  <span className="text-emerald-600">○{t?.yes ?? 0}</span>{" "}
                  <span className="text-amber-600">△{t?.maybe ?? 0}</span>{" "}
                  <span className="text-rose-500">×{t?.no ?? 0}</span>
                </td>
                {participants.map((p) => {
                  const a = answerOf.get(`${p.id}:${slot.id}`);
                  const mark = a ? MARK[a] : null;
                  return (
                    <td key={p.id} className="px-3 py-2 text-center">
                      <span className={mark ? mark.className : "text-slate-300"}>
                        {mark ? mark.text : "－"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {participants.some((p) => p.comment.trim()) && (
        <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          {participants
            .filter((p) => p.comment.trim())
            .map((p) => (
              <div key={p.id}>
                <span className="font-medium text-slate-600">{p.name}</span>：{p.comment}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
