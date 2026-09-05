import PollForm from "@/components/PollForm";
import { DEFAULT_TIMEZONE } from "@/lib/env";
import { currentAccount } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "日程調整をつくる — スキマ" };

export default async function NewPollPage() {
  const account = await currentAccount();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">日程調整をつくる</h1>
      <PollForm
        connected={Boolean(account?.accessToken)}
        defaultOrganizerName={account?.name ?? ""}
        timezone={DEFAULT_TIMEZONE}
      />
    </div>
  );
}
