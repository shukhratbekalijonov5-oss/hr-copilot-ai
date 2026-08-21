import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { candidateNotInVacancy, vacancyNotOwned } from './vacancy-policy';
import { APPLICANT_APPLICATION_SCOPE } from './applicant-scope';
import type {
  RequirementType,
  VacancyStatus,
} from '../../generated/prisma/enums';

/** The slice of a vacancy the requirement-consuming AI paths need. */
export interface OwnedVacancyWithRequirements {
  id: string;
  title: string;
  status: VacancyStatus;
  requirements: {
    id: string;
    text: string;
    type: RequirementType;
    required: boolean;
  }[];
}

/**
 * THE central owned-vacancy policy (see vacancy-policy.ts for the rule and
 * its disclosure semantics). Every vacancy-dependent surface — vacancy
 * mutations, candidate assignment, Compare/evidence-map, candidate-detail AI,
 * AI Search context, processing filter, interview invite and HR chat —
 * resolves the selected vacancy through this service instead of re-implementing
 * the two checks. One indexed query per resolution; no server-side "selected
 * vacancy" state exists — the client names the vacancy explicitly and it is
 * re-verified on every request.
 */
@Injectable()
export class OwnedVacancyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a vacancy the caller may operate in: active organization AND
   * personal creation. Foreign/unknown → 404; same-org non-creator → 403.
   */
  async requireOwned(
    userId: string,
    organizationId: string,
    vacancyId: string,
  ): Promise<{ id: string; title: string; status: VacancyStatus }> {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id: vacancyId, organizationId },
      select: { id: true, title: true, status: true, createdById: true },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    if (vacancy.createdById !== userId) throw vacancyNotOwned();
    return { id: vacancy.id, title: vacancy.title, status: vacancy.status };
  }

  /** requireOwned plus the requirements the AI grounding paths need. */
  async requireOwnedWithRequirements(
    userId: string,
    organizationId: string,
    vacancyId: string,
  ): Promise<OwnedVacancyWithRequirements> {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id: vacancyId, organizationId },
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        requirements: {
          select: { id: true, text: true, type: true, required: true },
        },
      },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    if (vacancy.createdById !== userId) throw vacancyNotOwned();
    return {
      id: vacancy.id,
      title: vacancy.title,
      status: vacancy.status,
      requirements: vacancy.requirements,
    };
  }

  /**
   * The candidate must have APPLIED to the selected vacancy — a DIRECT
   * Application row from an account-backed candidate is the only association
   * the product recognises (see applicant-scope.ts). This is the gate in front
   * of every candidate-in-vacancy AI path (Summary, Ask, Interview Questions,
   * JD Evidence/Compare), so a historical recruiter-made association cannot
   * reach any of them.
   *
   * Call after requireOwned; both ids are already known to be in the caller's
   * org, so a missing association is an honest 403, not a disclosure question.
   */
  async assertCandidateInVacancy(
    vacancyId: string,
    candidateId: string,
  ): Promise<void> {
    const association = await this.prisma.application.findFirst({
      where: { vacancyId, candidateId, ...APPLICANT_APPLICATION_SCOPE },
      select: { id: true },
    });
    if (!association) throw candidateNotInVacancy();
  }
}
