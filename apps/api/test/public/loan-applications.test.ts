import { describe, expect, it } from "vitest";

import { appRouter } from "../../src/router.js";
import {
  approvalInput,
  CapturingLogger,
  CapturingNotifier,
  createTestContext,
  highValueApplication,
  InMemoryLoanRepository,
  secondUnderwriter,
  supportAgent,
  thresholdApplication,
  underwriter,
} from "../support/in-memory-repository.js";

describe("loan application public examples", () => {
  it("returns the seeded pending application for review", async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.loanApplications.getForReview({ applicationId: "app-pending" });

    expect(result).toMatchObject({
      id: "app-pending",
      status: "PENDING_REVIEW",
      requestedAmountMinor: 500_000,
      customer: { fullName: "Olena Kovalenko" },
    });
    expect(result.customer).not.toHaveProperty("nationalId");
  });

  it("approves an eligible application", async () => {
    const repository = new InMemoryLoanRepository();
    const context = createTestContext(repository);
    const caller = appRouter.createCaller(context);

    const result = await caller.loanApplications.decide(approvalInput());

    expect(result).toMatchObject({
      applicationId: "app-pending",
      status: "APPROVED",
      approvedAmountMinor: 400_000,
    });
    expect(repository.audits).toHaveLength(1);
    expect(context.notifier.events).toEqual([{ applicationId: "app-pending", type: "APPROVED" }]);
  });

  it("rejects an application without an approved amount", async () => {
    const repository = new InMemoryLoanRepository();
    const context = createTestContext(repository);
    const caller = appRouter.createCaller(context);

    const result = await caller.loanApplications.decide({
      applicationId: "app-pending",
      decision: "REJECTED",
      reason: "The submitted income cannot be verified",
    });

    expect(result.status).toBe("REJECTED");
    expect(result.approvedAmountMinor).toBeNull();
    expect(context.notifier.events).toEqual([{ applicationId: "app-pending", type: "REJECTED" }]);
  });

  it("rejects an obviously empty reason at the input boundary", async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("loan decision workflow risks", () => {
  it("rejects a whitespace-only reason at the input boundary", async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "   " })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects zero and negative approval amounts", async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.loanApplications.decide(approvalInput({ approvedAmountMinor: 0 })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.loanApplications.decide(approvalInput({ approvedAmountMinor: -1 })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("forbids support users from recording a decision", async () => {
    const caller = appRouter.createCaller(
      createTestContext(new InMemoryLoanRepository(), supportAgent),
    );

    await expect(caller.loanApplications.decide(approvalInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("final-approves an amount at the delegated-authority threshold", async () => {
    const repository = new InMemoryLoanRepository([thresholdApplication]);
    const context = createTestContext(repository);
    const caller = appRouter.createCaller(context);

    const result = await caller.loanApplications.decide({
      applicationId: "app-at-threshold",
      decision: "APPROVED",
      approvedAmountMinor: 1_000_000,
      reason: "Within delegated authority",
    });

    expect(result).toMatchObject({
      status: "APPROVED",
      approvedAmountMinor: 1_000_000,
    });
    expect(context.notifier.events).toEqual([
      { applicationId: "app-at-threshold", type: "APPROVED" },
    ]);
  });

  it("sends a high-value approval for independent confirmation", async () => {
    const repository = new InMemoryLoanRepository([highValueApplication]);
    const context = createTestContext(repository);
    const caller = appRouter.createCaller(context);

    const result = await caller.loanApplications.decide({
      applicationId: "app-high-value",
      decision: "APPROVED",
      approvedAmountMinor: 1_500_000,
      reason: "Credit committee review required",
    });

    expect(result).toMatchObject({
      status: "PENDING_CONFIRMATION",
      approvedAmountMinor: 1_500_000,
    });
    expect(repository.applications.get("app-high-value")?.proposedByUserId).toBe(
      "user-underwriter-1",
    );
    expect(context.notifier.events).toEqual([
      { applicationId: "app-high-value", type: "APPROVAL_PROPOSED" },
    ]);
  });

  it("forbids the proposing underwriter from confirming their own approval", async () => {
    const repository = new InMemoryLoanRepository([highValueApplication]);
    const proposer = appRouter.createCaller(createTestContext(repository));
    await proposer.loanApplications.decide({
      applicationId: "app-high-value",
      decision: "APPROVED",
      approvedAmountMinor: 1_500_000,
      reason: "Credit committee review required",
    });

    await expect(
      proposer.loanApplications.decide({
        applicationId: "app-high-value",
        decision: "APPROVED",
        reason: "Confirming my own proposal",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a second underwriter confirm and preserves the proposed amount", async () => {
    const repository = new InMemoryLoanRepository([highValueApplication]);
    const proposer = appRouter.createCaller(createTestContext(repository));
    await proposer.loanApplications.decide({
      applicationId: "app-high-value",
      decision: "APPROVED",
      approvedAmountMinor: 1_500_000,
      reason: "Credit committee review required",
    });

    const notifier = new CapturingNotifier();
    const confirmer = appRouter.createCaller(
      createTestContext(repository, secondUnderwriter, new CapturingLogger(), notifier),
    );
    const result = await confirmer.loanApplications.decide({
      applicationId: "app-high-value",
      decision: "APPROVED",
      reason: "Independent review agrees",
    });

    expect(result).toMatchObject({
      status: "APPROVED",
      approvedAmountMinor: 1_500_000,
    });
    expect(notifier.events).toEqual([{ applicationId: "app-high-value", type: "APPROVED" }]);
  });

  it("allows the original approver to reject during confirmation and keeps history", async () => {
    const repository = new InMemoryLoanRepository([highValueApplication]);
    const caller = appRouter.createCaller(createTestContext(repository));
    await caller.loanApplications.decide({
      applicationId: "app-high-value",
      decision: "APPROVED",
      approvedAmountMinor: 1_500_000,
      reason: "Credit committee review required",
    });

    const result = await caller.loanApplications.decide({
      applicationId: "app-high-value",
      decision: "REJECTED",
      reason: "New information on income",
    });

    expect(result).toMatchObject({ status: "REJECTED", approvedAmountMinor: null });
    expect(repository.audits).toHaveLength(2);
    expect(repository.applications.get("app-high-value")?.proposedByUserId).toBeNull();
  });

  it("returns CONFLICT rather than 500 when the application is already decided", async () => {
    const repository = new InMemoryLoanRepository();
    const caller = appRouter.createCaller(createTestContext(repository));
    await caller.loanApplications.decide(approvalInput());

    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "Retry" })),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("does not persist a decision when the audit write fails", async () => {
    const repository = new InMemoryLoanRepository();
    repository.failNextAudit = true;
    const caller = appRouter.createCaller(createTestContext(repository));

    await expect(caller.loanApplications.decide(approvalInput())).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(repository.application.status).toBe("PENDING_REVIEW");
    expect(repository.audits).toHaveLength(0);
  });

  it("keeps the decision when notification delivery fails after commit", async () => {
    const repository = new InMemoryLoanRepository();
    const notifier = new CapturingNotifier();
    notifier.failNext = true;
    const caller = appRouter.createCaller(
      createTestContext(repository, underwriter, new CapturingLogger(), notifier),
    );

    const result = await caller.loanApplications.decide(approvalInput());

    expect(result.status).toBe("APPROVED");
    expect(repository.application.status).toBe("APPROVED");
    expect(notifier.events).toHaveLength(0);
  });
});
