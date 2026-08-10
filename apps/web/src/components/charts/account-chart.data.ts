/**
 * Deterministic demo dataset for the account chart. The real analytics store
 * does not model accounts; these rows exist for the component gallery and as
 * the typed contract for the chart component.
 */

export type AccountSegment = "Enterprise" | "Growth" | "Starter" | "Trial";

export type Account = {
  id: string;
  name: string;
  segment: AccountSegment;
  /** USD per month. */
  monthlyRevenue: number;
  /** 0–100, % of users still active after 30 days. */
  retention: number;
  /** Seated plan size. */
  seats: number;
};

export const ACCOUNT_SEGMENTS: readonly AccountSegment[] = [
  "Enterprise",
  "Growth",
  "Starter",
  "Trial",
];

export const ACCOUNTS: readonly Account[] = [
  { id: "acc-01", name: "Northwind Labs", segment: "Enterprise", monthlyRevenue: 118_400, retention: 94, seats: 412 },
  { id: "acc-02", name: "Acme Motion", segment: "Enterprise", monthlyRevenue: 96_800, retention: 91, seats: 288 },
  { id: "acc-03", name: "Globex Media", segment: "Enterprise", monthlyRevenue: 84_200, retention: 88, seats: 246 },
  { id: "acc-04", name: "Initech Cloud", segment: "Enterprise", monthlyRevenue: 71_600, retention: 85, seats: 194 },
  { id: "acc-05", name: "Umbra Studios", segment: "Growth", monthlyRevenue: 42_100, retention: 90, seats: 148 },
  { id: "acc-06", name: "Vertex Cart", segment: "Growth", monthlyRevenue: 37_500, retention: 82, seats: 121 },
  { id: "acc-07", name: "Sable Analytics", segment: "Growth", monthlyRevenue: 29_900, retention: 78, seats: 96 },
  { id: "acc-08", name: "Harbor Systems", segment: "Growth", monthlyRevenue: 22_400, retention: 74, seats: 68 },
  { id: "acc-09", name: "Fern & Co", segment: "Growth", monthlyRevenue: 16_200, retention: 71, seats: 44 },
  { id: "acc-10", name: "Juniper Desk", segment: "Starter", monthlyRevenue: 9_800, retention: 68, seats: 22 },
  { id: "acc-11", name: "Ridge Works", segment: "Starter", monthlyRevenue: 7_400, retention: 63, seats: 14 },
  { id: "acc-12", name: "Cove Forms", segment: "Starter", monthlyRevenue: 4_900, retention: 61, seats: 9 },
  { id: "acc-13", name: "Moss & Pixel", segment: "Starter", monthlyRevenue: 2_700, retention: 57, seats: 5 },
  { id: "acc-14", name: "Daybreak AI", segment: "Trial", monthlyRevenue: 0, retention: 52, seats: 3 },
  { id: "acc-15", name: "Orbit Press", segment: "Trial", monthlyRevenue: 0, retention: 48, seats: 2 },
  { id: "acc-16", name: "Bramble Notes", segment: "Trial", monthlyRevenue: 0, retention: 44, seats: 1 },
];
