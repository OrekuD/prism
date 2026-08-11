import { ACCOUNTS } from "@/components/charts/account-chart.data";
import { AccountChart } from "@/components/charts/account-chart";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useState } from "react";
import { cn } from "@/lib/utils";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ExampleLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>;
}

const formSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  note: z.string().min(10, "At least 10 characters."),
});

/**
 * Development-only component gallery (Task 4 verification surface).
 * Guarded at the router level so it can never ship in production builds.
 */
import { PrismMark, type PrismMarkVariant } from "@/components/brand/prism-mark";
import { PrismLogo } from "@/components/brand/prism-logo";

const BRAND_SIZES = [16, 20, 24, 32, 48, 64] as const;
const BRAND_VARIANTS: Array<PrismMarkVariant> = [
  "dark",
  "light",
  "monochrome",
  "black",
  "white",
  "violet",
];

export function Gallery() {
  const [focused, setFocused] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", note: "" },
  });

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

      <Section
        title="Brand"
        description="PrismMark and PrismLogo at every target size on dark and light surfaces (task-7 section 10)."
      >
        <div className="grid gap-8">
          <div className="grid gap-3 rounded-[2px] border border-border bg-canvas p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.09em] text-text-subtle">
              Dark surface
            </p>
            {BRAND_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-6">
                {BRAND_SIZES.map((size) => (
                  <PrismMark key={size} size={size} variant={variant} />
                ))}
                <PrismLogo size={20} variant={variant} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 rounded-[2px] border border-border bg-surface p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.09em] text-text-subtle">
              Light surface
            </p>
            {BRAND_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-6">
                {BRAND_SIZES.map((size) => (
                  <PrismMark key={size} size={size} variant={variant} />
                ))}
                <PrismLogo size={20} variant={variant} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Buttons" description="All variants, sizes, disabled and loading states.">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Icon only">✓</Button>
        </div>
      </Section>

      <Section title="Form controls" description="Input, textarea, label, checkbox with validation.">
        <Form {...form}>
        <form onSubmit={form.handleSubmit(() => undefined)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="you@example.com" {...field} />
                </FormControl>
                <FormDescription>Required, must be a valid address.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Note</FormLabel>
                <FormControl>
                  <Textarea placeholder="A longer description…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex items-center gap-2">
            <Checkbox id="gallery-terms" />
            <Label htmlFor="gallery-terms">Accept the terms</Label>
          </div>
          <Button type="submit">Validate</Button>
          <Button type="button" variant="outline" disabled>
            Busy state example
          </Button>
        </form>
        </Form>
      </Section>

      <Section title="Alerts & feedback" description="Informational and destructive alert variants.">
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>An informational alert with a long description that wraps across several lines to exercise long-copy layout.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>This action cannot be undone. Destructive alert variant.</AlertDescription>
        </Alert>
      </Section>

      <Section title="Overlays" description="Dialog, dropdown menu, popover, select, tabs.">
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Dialog title</DialogTitle>
                <DialogDescription>
                  Focus is trapped, Escape closes, focus returns to the trigger.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Content area. Use the keyboard: Tab cycles, Escape closes.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline">Cancel</Button>
                <Button type="button">Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <p className="text-sm font-medium">Popover content</p>
              <p className="text-sm text-muted-foreground">Closes on outside click or Escape.</p>
            </PopoverContent>
          </Popover>

          <Select>
            <SelectTrigger className="w-44" aria-label="Pick a plan">
              <SelectValue placeholder="Select plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="growth">Growth</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="disabled" disabled>Disabled</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-sm text-muted-foreground">Overview tab content.</TabsContent>
          <TabsContent value="events" className="text-sm text-muted-foreground">Events tab content.</TabsContent>
        </Tabs>
      </Section>

      <Section title="OTP input" description="Six-slot code entry, keyboard accessible.">
        <InputOTP maxLength={6} value={otp} onChange={setOtp} aria-label="One-time code">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </Section>

      <Section title="Calendar" description="Date selection with the current month.">
        <div className="rounded-md border p-3">
          <Calendar mode="single" className="w-fit" aria-label="Pick a date" />
        </div>
      </Section>

      <Section title="Loading & empty states">
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
          <ExampleLabel>Empty state pattern</ExampleLabel>
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No projects yet. Create one to get started.
          </div>
        </div>
      </Section>

      <Section title="Miscellaneous" description="Separator, badges, misc tokens.">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span>Inter UI text</span>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-mono text-xs">JetBrains Mono label</span>
            <Separator orientation="vertical" className="h-4" />
            <span className="tabular-nums">1,234,567</span>
          </div>
          <div className="flex gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
          <a className={cn(buttonVariants({ variant: "link" }), "text-sm")} href="#gallery">
            Link as button
          </a>
        </div>
      </Section>

      <Section title="AccountChart" description="monthlyRevenue × retention, radius ∝ √seats, color by segment. Focus or click a point for the original Account row.">
        <div className="space-y-2">
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
        </div>
      </Section>
    </div>
  );
}
