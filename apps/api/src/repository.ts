import type {
  LoanApplicationStatus as PrismaLoanApplicationStatus,
  PrismaClient,
} from "@loan-review/db";

import type {
  ApplyDecisionInput,
  LoanApplicationRecord,
  LoanApplicationStatus,
  LoanRepository,
} from "./domain.js";
import { LoanDecisionError } from "./domain.js";

function toRecord(application: {
  id: string;
  status: PrismaLoanApplicationStatus;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  customerFullName: string;
  customerLastName: string;
  customerGender: string;
  customerTaxId: string;
  customerEmail: string;
  customerPhone: string;
  customerNationalId: string;
  monthlyIncomeMinor: number;
}): LoanApplicationRecord {
  return {
    id: application.id,
    status: application.status as LoanApplicationStatus,
    requestedAmountMinor: application.requestedAmountMinor,
    approvedAmountMinor: application.approvedAmountMinor,
    proposedByUserId: application.proposedByUserId,
    customer: {
      fullName: application.customerFullName,
      lastName: application.customerLastName,
      gender: application.customerGender,
      taxId: application.customerTaxId,
      email: application.customerEmail,
      phone: application.customerPhone,
      nationalId: application.customerNationalId,
      monthlyIncomeMinor: application.monthlyIncomeMinor,
    },
  };
}

export class PrismaLoanRepository implements LoanRepository {
  constructor(private readonly client: PrismaClient) {}

  async findApplication(id: string): Promise<LoanApplicationRecord | null> {
    const application = await this.client.loanApplication.findUnique({ where: { id } });
    return application ? toRecord(application) : null;
  }

  async listApplications(): Promise<LoanApplicationRecord[]> {
    const applications = await this.client.loanApplication.findMany({
      orderBy: { createdAt: "desc" },
    });
    return applications.map(toRecord);
  }

  async deleteApplication(id: string): Promise<LoanApplicationRecord> {
    const application = await this.client.loanApplication.delete({ where: { id } });
    return toRecord(application);
  }

  async applyDecision(input: ApplyDecisionInput): Promise<LoanApplicationRecord> {
    return this.client.$transaction(async (tx) => {
      const updated = await tx.loanApplication.updateMany({
        where: { id: input.applicationId, status: input.expectedStatus },
        data: {
          status: input.newStatus as PrismaLoanApplicationStatus,
          approvedAmountMinor: input.approvedAmountMinor,
          proposedByUserId: input.proposedByUserId,
        },
      });

      if (updated.count !== 1) {
        throw new LoanDecisionError("CONFLICT", "Application already decided");
      }

      await tx.loanDecisionAudit.create({
        data: {
          applicationId: input.audit.applicationId,
          actorId: input.audit.actorId,
          previousStatus: input.audit.previousStatus as PrismaLoanApplicationStatus,
          newStatus: input.audit.newStatus as PrismaLoanApplicationStatus,
          approvedAmountMinor: input.audit.approvedAmountMinor,
          reason: input.audit.reason,
        },
      });

      const application = await tx.loanApplication.findUniqueOrThrow({
        where: { id: input.applicationId },
      });
      return toRecord(application);
    });
  }
}
