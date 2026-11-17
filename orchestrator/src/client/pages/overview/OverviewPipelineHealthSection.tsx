import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import type { ExtractorSourceId } from "@shared/extractors";
import { sourceLabel } from "@shared/extractors";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Filter, Loader2 } from "lucide-react";
import type React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-lg font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export const OverviewPipelineHealthSection: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.pipeline.health(),
    queryFn: api.getPipelineHealth,
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Pipeline health
        </CardTitle>
        <CardDescription>
          Discovery yield, scoring progress, and AI quota saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError || !data ? (
          <div className="text-sm text-muted-foreground">
            Health data unavailable.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Total jobs" value={data.totalJobs} />
              <Stat label="Scored" value={data.scoredJobs} />
              <Stat label="Pending" value={data.pendingJobs} />
              <Stat label="Pre-filtered" value={data.prefilteredJobs} />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" />
                {data.cachedAiResponses.toLocaleString()} cached AI responses
              </span>
              <span className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                {data.prefilteredJobs.toLocaleString()} skipped AI scoring
                (quota saved)
              </span>
              {data.lastRun ? (
                <span>
                  Last run:{" "}
                  <span className="text-foreground">{data.lastRun.status}</span>
                </span>
              ) : null}
            </div>

            {data.jobsBySource.length > 0 ? (
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Jobs by source
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.jobsBySource.map((s) => (
                    <span
                      key={s.source}
                      className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-xs text-foreground"
                    >
                      {sourceLabel(s.source as ExtractorSourceId) ?? s.source}{" "}
                      <span className="text-muted-foreground tabular-nums">
                        {s.count}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
