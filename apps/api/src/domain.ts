import type { LoanNotificationType, LoanNotifier } from "./notifier.js";

export type UserRole = "UNDERWRITER" | "SUPPORT";
export type LoanApplicationStatus =
  "PENDING_REVIEW" | "PENDING_CONFIRMATION" | "APPROVED" | "REJECTED";
export type LoanDecision = "APPROVED" | "REJECTED";

export const DELEGATED_AUTHORITY_THRESHOLD_MINOR = 1_000_000;

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface LoanApplicationRecord {
  id: string;
  status: LoanApplicationStatus;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  customer: {
    fullName: string;
    lastName: string;
    gender: string;
    taxId: string;
    email: string;
    phone: string;
    nationalId: string;
    monthlyIncomeMinor: number;
  };
}

export interface LoanApplicationView {
  id: string;
  status: LoanApplicationStatus;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  customer: {
    fullName: string;
    lastName: string;
    gender: string;
    taxId: string;
    email: string;
  };
}

export interface DecideLoanApplicationInput {
  applicationId: string;
  decision: LoanDecision;
  approvedAmountMinor?: number | undefined;
  reason: string;
}

export interface AuditRecordInput {
  applicationId: string;
  actorId: string;
  previousStatus: LoanApplicationStatus;
  newStatus: LoanApplicationStatus;
  approvedAmountMinor: number | null;
  reason: string;
}

export interface ApplyDecisionInput {
  applicationId: string;
  expectedStatus: LoanApplicationStatus;
  newStatus: LoanApplicationStatus;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  audit: AuditRecordInput;
}

export interface LoanRepository {
  findApplication(id: string): Promise<LoanApplicationRecord | null>;
  listApplications(): Promise<LoanApplicationRecord[]>;
  deleteApplication(id: string): Promise<LoanApplicationRecord>;
  applyDecision(input: ApplyDecisionInput): Promise<LoanApplicationRecord>;
}

export interface AppLogger {
  info(context: Record<string, unknown>, message: string): void;
}

export interface RequestContext {
  repository: LoanRepository;
  session: { user: SessionUser } | null;
  logger: AppLogger;
  notifier: LoanNotifier;
}

export class LoanDecisionError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "LoanDecisionError";
  }
}

export interface DecisionPlan {
  newStatus: LoanApplicationStatus;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  notificationType: LoanNotificationType;
}

function assertNoAmount(approvedAmountMinor: number | undefined, message: string): void {
  if (approvedAmountMinor !== undefined) {
    throw new LoanDecisionError("BAD_REQUEST", message);
  }
}

function assertApprovalAmount(
  application: LoanApplicationRecord,
  approvedAmountMinor: number | undefined,
): number {
  if (
    approvedAmountMinor === undefined ||
    !Number.isInteger(approvedAmountMinor) ||
    approvedAmountMinor <= 0 ||
    approvedAmountMinor > application.requestedAmountMinor
  ) {
    throw new LoanDecisionError("BAD_REQUEST", "Invalid approved amount");
  }

  return approvedAmountMinor;
}

export function planLoanDecision(
  application: LoanApplicationRecord,
  actor: SessionUser,
  input: Pick<DecideLoanApplicationInput, "decision" | "approvedAmountMinor">,
): DecisionPlan {
  if (application.status === "APPROVED" || application.status === "REJECTED") {
    throw new LoanDecisionError("CONFLICT", "Application already decided");
  }

  if (input.decision === "REJECTED") {
    if (application.status !== "PENDING_REVIEW" && application.status !== "PENDING_CONFIRMATION") {
      throw new LoanDecisionError("CONFLICT", "Application cannot be rejected");
    }
    assertNoAmount(input.approvedAmountMinor, "Rejection cannot have an amount");
    return {
      newStatus: "REJECTED",
      approvedAmountMinor: null,
      proposedByUserId: null,
      notificationType: "REJECTED",
    };
  }

  if (application.status === "PENDING_REVIEW") {
    const amount = assertApprovalAmount(application, input.approvedAmountMinor);
    if (amount <= DELEGATED_AUTHORITY_THRESHOLD_MINOR) {
      return {
        newStatus: "APPROVED",
        approvedAmountMinor: amount,
        proposedByUserId: null,
        notificationType: "APPROVED",
      };
    }

    return {
      newStatus: "PENDING_CONFIRMATION",
      approvedAmountMinor: amount,
      proposedByUserId: actor.id,
      notificationType: "APPROVAL_PROPOSED",
    };
  }

  if (application.status === "PENDING_CONFIRMATION") {
    assertNoAmount(input.approvedAmountMinor, "Confirmation cannot have an amount");
    if (!application.proposedByUserId) {
      throw new LoanDecisionError("CONFLICT", "Application is missing a proposer");
    }
    if (actor.id === application.proposedByUserId) {
      throw new LoanDecisionError(
        "FORBIDDEN",
        "The proposing underwriter cannot confirm this approval",
      );
    }
    return {
      newStatus: "APPROVED",
      approvedAmountMinor: application.approvedAmountMinor,
      proposedByUserId: application.proposedByUserId,
      notificationType: "APPROVED",
    };
  }

  throw new LoanDecisionError("CONFLICT", "Application cannot receive this decision");
}
