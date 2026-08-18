import type { LoanNotification, LoanNotifier } from "../../src/notifier.js";
import type {
  AppLogger,
  ApplyDecisionInput,
  AuditRecordInput,
  LoanApplicationRecord,
  LoanRepository,
  RequestContext,
  SessionUser,
} from "../../src/domain.js";
import { LoanDecisionError } from "../../src/domain.js";

const seededApplication: LoanApplicationRecord = {
  id: "app-pending",
  status: "PENDING_REVIEW",
  requestedAmountMinor: 500_000,
  approvedAmountMinor: null,
  proposedByUserId: null,
  customer: {
    fullName: "Olena Kovalenko",
    lastName: "Kovalenko",
    gender: "FEMALE",
    taxId: "TAX-72419831",
    email: "olena@example.test",
    phone: "+380501234567",
    nationalId: "ID-72419831",
    monthlyIncomeMinor: 180_000,
  },
};

export const highValueApplication: LoanApplicationRecord = {
  id: "app-high-value",
  status: "PENDING_REVIEW",
  requestedAmountMinor: 2_000_000,
  approvedAmountMinor: null,
  proposedByUserId: null,
  customer: {
    fullName: "High Value Fixture",
    lastName: "Fixture",
    gender: "MALE",
    taxId: "TAX-HIGH-VALUE",
    email: "high-value@example.test",
    phone: "+380500000003",
    nationalId: "ID-HIGH-VALUE",
    monthlyIncomeMinor: 600_000,
  },
};

export const thresholdApplication: LoanApplicationRecord = {
  id: "app-at-threshold",
  status: "PENDING_REVIEW",
  requestedAmountMinor: 1_000_000,
  approvedAmountMinor: null,
  proposedByUserId: null,
  customer: {
    fullName: "Threshold Fixture",
    lastName: "Fixture",
    gender: "NON_BINARY",
    taxId: "TAX-THRESHOLD",
    email: "threshold@example.test",
    phone: "+380500000002",
    nationalId: "ID-THRESHOLD",
    monthlyIncomeMinor: 300_000,
  },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryLoanRepository implements LoanRepository {
  applications = new Map<string, LoanApplicationRecord>();
  audits: AuditRecordInput[] = [];
  failNextAudit = false;

  constructor(seed: LoanApplicationRecord[] = [seededApplication]) {
    for (const application of seed) {
      this.applications.set(application.id, clone(application));
    }
  }

  get application(): LoanApplicationRecord {
    const application = this.applications.get("app-pending");
    if (!application) {
      throw new Error("app-pending is not in the repository");
    }
    return application;
  }

  async findApplication(id: string): Promise<LoanApplicationRecord | null> {
    const application = this.applications.get(id);
    return application ? clone(application) : null;
  }

  async listApplications(): Promise<LoanApplicationRecord[]> {
    return [...this.applications.values()].map((application) => clone(application));
  }

  async deleteApplication(id: string): Promise<LoanApplicationRecord> {
    const application = this.applications.get(id);
    if (!application) {
      throw new Error("Application not found");
    }
    this.applications.delete(id);
    return clone(application);
  }

  async applyDecision(input: ApplyDecisionInput): Promise<LoanApplicationRecord> {
    const current = this.applications.get(input.applicationId);
    if (!current || current.status !== input.expectedStatus) {
      throw new LoanDecisionError("CONFLICT", "Application already decided");
    }

    const previous = clone(current);
    current.status = input.newStatus;
    current.approvedAmountMinor = input.approvedAmountMinor;
    current.proposedByUserId = input.proposedByUserId;

    if (this.failNextAudit) {
      this.failNextAudit = false;
      this.applications.set(input.applicationId, previous);
      throw new Error("Injected audit failure");
    }

    this.audits.push(clone(input.audit));
    return clone(current);
  }
}

export class CapturingLogger implements AppLogger {
  events: Array<{ context: Record<string, unknown>; message: string }> = [];

  info(context: Record<string, unknown>, message: string): void {
    this.events.push({ context: clone(context), message });
  }
}

export class CapturingNotifier implements LoanNotifier {
  events: LoanNotification[] = [];
  failNext = false;

  async send(notification: LoanNotification): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Injected notification failure");
    }
    this.events.push(clone(notification));
  }
}

export const underwriter: SessionUser = {
  id: "user-underwriter-1",
  name: "Ada Underwriter",
  role: "UNDERWRITER",
};

export const secondUnderwriter: SessionUser = {
  id: "user-underwriter-2",
  name: "Grace Underwriter",
  role: "UNDERWRITER",
};

export const supportAgent: SessionUser = {
  id: "user-support-1",
  name: "Sam Support",
  role: "SUPPORT",
};

export function createTestContext(
  repository = new InMemoryLoanRepository(),
  user: SessionUser = underwriter,
  logger = new CapturingLogger(),
  notifier = new CapturingNotifier(),
): RequestContext & { notifier: CapturingNotifier } {
  return { repository, session: { user }, logger, notifier };
}

export function approvalInput(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: "app-pending",
    decision: "APPROVED" as const,
    approvedAmountMinor: 400_000,
    reason: "Affordability checks passed",
    ...overrides,
  };
}
