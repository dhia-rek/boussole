import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "@/client/api";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { PageMain } from "../components/layout";
import { MockInterviewRoom } from "../components/mock-interview/MockInterviewModal";

/** Opens the mock interview for one job directly (linked from Today). */
export const InterviewPage: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const jobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.getJob(id),
    enabled: Boolean(id),
  });

  if (jobQuery.isLoading) {
    return (
      <PageMain className="max-w-3xl">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </PageMain>
    );
  }
  if (!jobQuery.data) {
    return (
      <PageMain className="max-w-3xl space-y-3">
        <p className="text-sm text-muted-foreground">
          This job doesn't exist anymore.
        </p>
        <Button asChild variant="outline">
          <Link to="/today">Back to Today</Link>
        </Button>
      </PageMain>
    );
  }
  return (
    <MockInterviewRoom job={jobQuery.data} onClose={() => navigate("/today")} />
  );
};
