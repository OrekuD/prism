import { ACCOUNTS } from "@/components/charts/account-chart.data";
import { AccountChart } from "@/components/charts/account-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";

/**
 * Development-only component gallery (Task 4 verification surface).
 * Guarded at the router level so it can never ship in production builds.
 */
export function Gallery() {
  const [focused, setFocused] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const focusedAccount = ACCOUNTS.find((account) => account.id === focused);
  const selectedAccount = ACCOUNTS.find((account) => account.id === selected);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Component gallery</h1>
        <p className="text-sm text-muted-foreground">
          Development-only verification surface for primitives and chart
          composites. Never exposed in production builds.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AccountChart</CardTitle>
          <CardDescription>
            monthlyRevenue × retention, point radius ∝ √seats, color by
            segment. Focus or click a point to see the original Account row.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <AccountChart
            accounts={ACCOUNTS}
            ariaLabel="Accounts by monthly revenue and retention, sized by seats and colored by segment"
            onFocusChange={(account) => setFocused(account?.id ?? null)}
            onSelect={(account) => setSelected(account?.id ?? null)}
          />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Focused account</dt>
              <dd className="font-medium">
                {focusedAccount
                  ? `${focusedAccount.name} (${focusedAccount.segment})`
                  : "—"}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Selected account</dt>
              <dd className="font-medium">
                {selectedAccount
                  ? `${selectedAccount.name} — $${selectedAccount.monthlyRevenue.toLocaleString()}/mo`
                  : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
