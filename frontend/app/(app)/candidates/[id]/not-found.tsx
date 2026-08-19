import { NotFoundState } from "@/components/ui/NotFoundState";

export default function CandidateNotFound() {
  return (
    <NotFoundState
      title="Candidate not found"
      description="This candidate may have been removed, or the link is wrong."
      backHref="/candidates"
      backLabel="Back to candidates"
    />
  );
}
