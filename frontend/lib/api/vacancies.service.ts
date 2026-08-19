import { ApiError, matchesSearch, mockRequest } from "@/lib/api/client";
import { organization } from "@/lib/mock/seed/org";
import { candidates, findVacancy, vacancies } from "@/lib/mock/store";
import { summarizeProcessing } from "@/lib/utils";
import type {
  Candidate,
  CreateVacancyInput,
  JobRequirement,
  Vacancy,
  VacancyQuery,
} from "@/lib/types";

/** Session-scoped additions from the create form. Replaced by the backend. */
const createdVacancies: Vacancy[] = [];

function allVacancies(): Vacancy[] {
  return [...createdVacancies, ...vacancies];
}

export async function getVacancies(query: VacancyQuery = {}): Promise<Vacancy[]> {
  return mockRequest(() => {
    const status = query.status ?? "all";
    const department = query.department ?? "all";

    return allVacancies()
      .filter((vacancy) => (status === "all" ? true : vacancy.status === status))
      .filter((vacancy) =>
        department === "all" ? true : vacancy.department === department,
      )
      .filter((vacancy) =>
        matchesSearch(
          query.search ?? "",
          vacancy.title,
          vacancy.department,
          vacancy.location,
        ),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  });
}

export async function getVacancy(id: string): Promise<Vacancy> {
  return mockRequest(() => {
    const vacancy =
      createdVacancies.find((item) => item.id === id) ?? findVacancy(id);
    if (!vacancy) {
      throw new ApiError(`Vacancy ${id} was not found.`, 404);
    }
    return vacancy;
  });
}

export async function getVacancyCandidates(
  vacancyId: string,
): Promise<Candidate[]> {
  return mockRequest(() =>
    candidates
      .filter((candidate) => candidate.primaryVacancyId === vacancyId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
  );
}

export async function getDepartments(): Promise<string[]> {
  return mockRequest(
    () => [...new Set(allVacancies().map((vacancy) => vacancy.department))].sort(),
    0,
  );
}

export async function createVacancy(
  input: CreateVacancyInput,
): Promise<Vacancy> {
  return mockRequest(() => {
    if (!input.title.trim()) {
      throw new ApiError("Vacancy title is required.", 422, {
        title: "Vacancy title is required.",
      });
    }
    if (input.requirements.length === 0) {
      throw new ApiError("Add at least one requirement.", 422, {
        requirements: "Add at least one requirement.",
      });
    }

    const id = `vac-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const requirements: JobRequirement[] = input.requirements.map(
      (requirement, index) => ({
        id: `${id}-req-${index + 1}`,
        vacancyId: id,
        label: requirement.label,
        detail: requirement.detail ?? null,
        kind: requirement.kind,
        category: requirement.category,
        position: index,
      }),
    );

    const vacancy: Vacancy = {
      id,
      organizationId: organization.id,
      title: input.title.trim(),
      department: input.department.trim(),
      location: input.location.trim(),
      employmentType: input.employmentType,
      experienceLevel: input.experienceLevel,
      status: input.status,
      description: input.description.trim(),
      requirements,
      preferredSkills: input.preferredSkills,
      candidateCount: 0,
      processing: summarizeProcessing([]),
      ownerId: "usr-1",
      createdAt: now,
      updatedAt: now,
    };

    createdVacancies.unshift(vacancy);
    return vacancy;
  }, 700);
}
