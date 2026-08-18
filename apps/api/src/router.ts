import { initTRPC, TRPCError, type inferRouterInputs } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

import type { LoanApplicationRecord, LoanApplicationView, RequestContext } from "./domain.js";
import { LoanDecisionError, planLoanDecision } from "./domain.js";

const t = initTRPC.context<RequestContext>().create({ transformer: superjson });

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const underwriterProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.user.role !== "UNDERWRITER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only underwriters may record a decision" });
  }
  return next({ ctx });
});

export const decideLoanApplicationSchema = z.object({
  applicationId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  approvedAmountMinor: z.number().int().positive().optional(),
  reason: z.string().trim().min(1),
});

function toView(application: LoanApplicationRecord): LoanApplicationView {
  return {
    id: application.id,
    status: application.status,
    requestedAmountMinor: application.requestedAmountMinor,
    approvedAmountMinor: application.approvedAmountMinor,
    proposedByUserId: application.proposedByUserId,
    customer: {
      fullName: application.customer.fullName,
      lastName: application.customer.lastName,
      gender: application.customer.gender,
      taxId: application.customer.taxId,
      email: application.customer.email,
    },
  };
}

function rethrowDecisionFailure(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }
  if (error instanceof LoanDecisionError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Decision failed",
  });
}

export const appRouter = t.router({
  loanApplications: t.router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const applications = await ctx.repository.listApplications();
      return applications.map(toView);
    }),

    delete: underwriterProcedure
      .input(z.object({ applicationId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const application = await ctx.repository.deleteApplication(input.applicationId);
        return toView(application);
      }),

    getForReview: protectedProcedure
      .input(z.object({ applicationId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const application = await ctx.repository.findApplication(input.applicationId);
        if (!application) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
        }
        return toView(application);
      }),

    decide: underwriterProcedure
      .input(decideLoanApplicationSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const application = await ctx.repository.findApplication(input.applicationId);
          if (!application) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
          }

          ctx.logger.info(
            {
              applicationId: application.id,
              actorId: ctx.session.user.id,
              actorRole: ctx.session.user.role,
              decision: input.decision,
              previousStatus: application.status,
              approvedAmountMinor: input.approvedAmountMinor ?? null,
            },
            "Processing loan decision",
          );

          const plan = planLoanDecision(application, ctx.session.user, input);

          const updated = await ctx.repository.applyDecision({
            applicationId: application.id,
            expectedStatus: application.status,
            newStatus: plan.newStatus,
            approvedAmountMinor: plan.approvedAmountMinor,
            proposedByUserId: plan.proposedByUserId,
            audit: {
              applicationId: application.id,
              actorId: ctx.session.user.id,
              previousStatus: application.status,
              newStatus: plan.newStatus,
              approvedAmountMinor: plan.approvedAmountMinor,
              reason: input.reason,
            },
          });

          try {
            await ctx.notifier.send({
              applicationId: updated.id,
              type: plan.notificationType,
            });
          } catch {
            ctx.logger.info(
              { applicationId: updated.id, type: plan.notificationType },
              "Notification delivery failed",
            );
          }

          return {
            applicationId: updated.id,
            status: updated.status,
            approvedAmountMinor: updated.approvedAmountMinor,
          };
        } catch (error: unknown) {
          rethrowDecisionFailure(error);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
export type DecideLoanApplicationInput = inferRouterInputs<AppRouter>["loanApplications"]["decide"];
