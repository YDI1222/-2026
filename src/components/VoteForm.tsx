"use client";

import { useState } from "react";
import { saveResponseAction } from "@/app/actions";
import type { Answer } from "@/lib/types";

interface SlotView {
  id: string;
  label: string;
}

interface Props {
  pollId: string;
  slots: SlotView[];
  /** 編集モードのとき、既存の回答を渡す。 */
  initial?: {
    participantId: string;
    editToken: string;
    name: string;
    comment: string;
    email: string | null;
    answers: Record<string, Answer>;
  } | null;
  askEmail: boolean;
}

const CHOICES: { value: Answer; mark: string; label: string; active: string }[] = [
  { value: "yes", mark: "○", label: "参加できる", active: "border-emerald-500 bg-emerald-50 text-emerald-700" },
  { value: "maybe", mark: "△", label: "調整すれば可", active: "border-amber-500 bg-amber-50 text-amber-700" },
  { value: "no", mark: "×", label: "参加できない", active: "border-rose-400 bg-rose-50 text-rose-600" },
];

export default function VoteForm({ pollId, slots, initial, askEmail }: Props) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(initial?.answers ?? {});

  const setAll = (value: Answer) => {
    const next: Record<string, Answer> = {};
    for (const s of slots) next[s.id] = value;
    setAnswers(next);
  };

  return (
    <form action={saveResponseAction} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="pollId" value={pollId} />
      {initial && (
        <>
          <input type="hidden" name="participantId" value={initial.participantId} />
          <input type="hidden" name="editToken" value={initial.editToken} />
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">
          {initial ? "回答を編集する" : "あなたの回答"}
        </h2>
        <button
          type="button"
          onClick={() => setAll("yes")}
          className="text-sm text-brand-600 hover:underline"
        >
          すべて○にする
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm text-slate-600">お名前</span>
        <input
          name="name"
          required
          maxLength={60}
          defaultValue={initial?.name ?? ""}
          placeholder="例：山田"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
        />
      </label>

      {askEmail && (
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">
            メールアドレス（任意・カレンダー招待に使います）
          </span>
          <input
            name="email"
            type="email"
            maxLength={200}
            defaultValue={initial?.email ?? ""}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>
      )}

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {slots.map((slot) => (
          <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm tabular-nums text-slate-700">{slot.label}</span>
            <div className="flex gap-1.5">
              {CHOICES.map((choice) => {
                const selected = answers[slot.id] === choice.value;
                return (
                  <label
                    key={choice.value}
                    title={choice.label}
                    className={`grid size-10 cursor-pointer place-items-center rounded-lg border text-lg ${
                      selected ? choice.active : "border-slate-200 text-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`answer_${slot.id}`}
                      value={choice.value}
                      checked={selected}
                      onChange={() => setAnswers((prev) => ({ ...prev, [slot.id]: choice.value }))}
                      className="sr-only"
                    />
                    {choice.mark}
                  </label>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <label className="block">
        <span className="mb-1 block text-sm text-slate-600">ひとこと（任意）</span>
        <input
          name="comment"
          maxLength={200}
          defaultValue={initial?.comment ?? ""}
          placeholder="例：18時以降なら確実です"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
        />
      </label>

      <button
        type="submit"
        className="w-full rounded-lg bg-brand-600 px-6 py-2.5 font-medium text-white hover:bg-brand-700"
      >
        {initial ? "回答を更新する" : "回答する"}
      </button>
    </form>
  );
}
