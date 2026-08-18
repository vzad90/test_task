import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DecisionForm } from "../../src/components/DecisionForm";

describe("DecisionForm", () => {
  it("submits an approval in integer minor units", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm onSubmit={onSubmit} requestedAmountMinor={500_000} />);

    await user.type(screen.getByLabelText(/Approved amount/), "1250.50");
    await user.type(screen.getByLabelText("Reason"), "Affordability checks passed");
    await user.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        decision: "APPROVED",
        approvedAmountMinor: 125_050,
        reason: "Affordability checks passed",
      }),
    );
  });

  it("omits an amount when confirming a proposed approval", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm onSubmit={onSubmit} requestedAmountMinor={2_000_000} variant="confirm" />);

    expect(screen.queryByLabelText(/Approved amount/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason"), "Independent review agrees");
    await user.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        decision: "APPROVED",
        reason: "Independent review agrees",
      }),
    );
  });
});
