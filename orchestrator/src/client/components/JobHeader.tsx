import { isKeywordEstimate } from "@shared/scoring";
import type { AppliedDuplicateMatch, Job } from "@shared/types.js";
import { Calendar, DollarSign, MapPin } from "lucide-react";
import type React from "react";
import { Link, useLocation } from "react-router-dom";
import { cn, formatDate, sourceLabel } from "@/lib/utils";
import { ScoreRing } from "../pages/job-page/JobPageLeftSidebar";
import { appliedDuplicateIndicator } from "../pages/orchestrator/constants";
import {
  getJobStatusIndicator,
  getTracerStatusIndicator,
  StatusIndicator,
} from "./StatusIndicator";

interface JobHeaderProps {
  job: Job;
  className?: string;
  jobCTA?: React.ReactNode;
}

const AppliedDuplicatePill: React.FC<{
  match: AppliedDuplicateMatch | null | undefined;
}> = ({ match }) => {
  if (!match) {
    return null;
  }

  const appliedDate = formatDate(match.appliedAt) ?? "Unknown date";
  const tooltip = (
    <div className="space-y-1">
      <p className="text-xs font-medium">{match.title}</p>
      <p className="text-xs opacity-80">{match.employer}</p>
      <p className="text-[10px] opacity-80">
        Applied {appliedDate} · {match.score}% match
      </p>
    </div>
  );

  return (
    <StatusIndicator
      dotColor={appliedDuplicateIndicator.dot}
      label={appliedDuplicateIndicator.label}
      className="cursor-help"
      tooltip={tooltip}
      tooltipClassName="max-w-xs"
    />
  );
};

export const JobHeader: React.FC<JobHeaderProps> = ({
  job,
  className,
  jobCTA,
}) => {
  const jobStatus = getJobStatusIndicator(job.status);
  // Jobs found by a source that was later removed keep its raw id.
  const sourceDisplayName = job.source
    ? (sourceLabel[job.source] ?? job.source)
    : "Unknown Source";
  const tracerStatus = getTracerStatusIndicator(job.tracerLinksEnabled);
  const location = useLocation();
  const { pathname } = location;
  const isJobPage = pathname.startsWith("/job/");
  const jobPageLinkState = isJobPage
    ? undefined
    : { jobPageBackTo: `${location.pathname}${location.search}` };
  const deadline = formatDate(job.deadline);
  const jobStatusTooltip =
    job.status === "discovered" ? (
      <p className="text-xs">Found by the pipeline. Not tailored yet.</p>
    ) : job.status === "ready" ? (
      <p className="text-xs">Tailored and ready to apply.</p>
    ) : undefined;
  const tracerStatusTooltip = !job.tracerLinksEnabled ? (
    <p className="text-xs">
      Tracer links are turned off for this job, so click tracking will not be
      recorded.
    </p>
  ) : undefined;
  return (
    <div
      className={cn(
        "space-y-3 p-4 bg-muted/30 rounded-lg rounded-b-none border border-b-0 border-border",
        className,
      )}
    >
      {/* Detail header: title + score on top, actions on their own row so
          long titles never get squeezed into a narrow column. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            to={`/job/${job.id}`}
            state={jobPageLinkState}
            className="block text-xl font-bold underline-offset-2 break-words hover:underline"
          >
            {job.title}
          </Link>

          <span>{job.employer}</span>

          <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground/70 mt-1">
            {(job.location || job.isRemote) && (
              <span className="flex items-center gap-1">
                <MapPin className="size-4" />
                {job.location?.trim()}
                {job.isRemote && ", Remote"}
              </span>
            )}
            {deadline && (
              <span className="flex items-center gap-1">
                <Calendar className="size-4" />
                {deadline}
              </span>
            )}
            {job.salary && (
              <span className="flex items-center gap-1">
                <DollarSign className="size-4" />
                {job.salary}
              </span>
            )}
          </div>
        </div>

        <ScoreRing
          score={job.suitabilityScore}
          size="sm"
          estimated={isKeywordEstimate(job.suitabilityReason)}
        />
      </div>

      {jobCTA ? (
        <div className="flex flex-wrap items-center justify-end gap-2 [&>div]:flex-wrap">
          {jobCTA}
        </div>
      ) : null}

      {/* Status and score: single line, subdued */}
      <div className="flex items-center justify-between gap-2 py-1 border-y border-border/30 flex-wrap">
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          <StatusIndicator
            dotColor={jobStatus.dotColor}
            label={jobStatus.label}
            tooltip={jobStatusTooltip}
            tooltipClassName="max-w-xs"
            className={jobStatusTooltip ? "cursor-help" : undefined}
          />
          <StatusIndicator
            dotColor={tracerStatus.dotColor}
            label={tracerStatus.label}
            tooltip={tracerStatusTooltip}
            tooltipClassName="max-w-xs"
            className={tracerStatusTooltip ? "cursor-help" : undefined}
          />

          <AppliedDuplicatePill match={job.appliedDuplicateMatch} />

          {job.source && (
            <StatusIndicator
              variant="sky"
              tooltip={`Job found on ${sourceDisplayName}`}
              label={sourceDisplayName}
            />
          )}

          {job.isRemote === true && (
            <StatusIndicator
              variant="emerald"
              label="Remote"
              dotColor="bg-emerald-400"
              tooltip="The job claims to be remote"
            />
          )}
        </div>
      </div>
    </div>
  );
};
