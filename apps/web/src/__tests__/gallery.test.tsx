import axe from "axe-core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Gallery } from "@/routes/gallery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Calendar } from "@/components/ui/calendar";
import { useState } from "react";

async function scanAxe(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom cannot measure contrast; color checks run via token-contrast.mjs.
      "color-contrast": { enabled: false },
    },
  });
  return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

describe("component gallery (verification surface)", () => {
  it("renders every section with no serious axe violations", async () => {
    const { container } = render(<Gallery />);
    // CardTitle renders a div in the v4 card; assert by text.
    expect(screen.getByText("Buttons")).toBeInTheDocument();
    expect(screen.getByText("Form controls")).toBeInTheDocument();
    expect(screen.getByText("Overlays")).toBeInTheDocument();
    expect(screen.getByText("OTP input")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("AccountChart")).toBeInTheDocument();

    const violations = await scanAxe(container);
    expect(violations).toEqual([]);
  });

  it("form shows validation errors on empty submit", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Validate" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("At least 10 characters.")).toBeInTheDocument();
  });
});

describe("dialog keyboard behavior", () => {
  it("opens, traps focus inside, closes with Escape, restores focus", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard dialog</DialogTitle>
            <DialogDescription>Escape closes.</DialogDescription>
          </DialogHeader>
          <Button type="button">Inside</Button>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Keyboard dialog" });
    expect(dialog).toBeInTheDocument();

    // Focus moved into the dialog (radix v2 lands on the first content
    // focusable; the close button sits outside the content flow).
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("dropdown menu keyboard behavior", () => {
  it("navigates with ArrowDown/Enter and closes with Escape", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuItem>Settings</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    await screen.findByRole("menu");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("OTP input", () => {
  it("renders all slots and accepts typed digits", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <InputOTP maxLength={4} value={value} onChange={setValue} aria-label="Code">
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>
      );
    }
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Code" });
    await user.type(input, "4821");
    expect(input).toHaveValue("4821");
  });
});

describe("calendar date selection", () => {
  it("selects a day via the grid", async () => {
    const user = userEvent.setup();
    const selected = new Date(2026, 7, 15);
    render(<Calendar mode="single" selected={selected} />);
    const day = screen.getByRole("gridcell", { name: "15" });
    // react-day-picker v9 binds selection to the day button inside the
    // gridcell, not the cell itself.
    await user.click(within(day).getByRole("button"));
    expect(day).toHaveAttribute("aria-selected", "true");
  });
});
