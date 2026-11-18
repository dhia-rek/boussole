import { Compass } from "lucide-react";
import type React from "react";
import { Link } from "react-router-dom";
import { PageHeader, PageMain } from "@/client/components/layout";
import { Button } from "@/components/ui/button";

/** Shown for any address the app doesn't know, instead of an empty page. */
export const NotFoundPage: React.FC = () => (
  <>
    <PageHeader
      icon={Compass}
      title="Page not found"
      subtitle="Nothing lives at this address"
    />
    <PageMain>
      <section className="mx-auto max-w-md rounded-xl border border-border/60 bg-card/60 p-6 text-center">
        <h2 className="font-display text-xl font-bold">
          This page doesn't exist
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be old or mistyped. Your jobs and CV are where you left
          them.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/today">Go to Today</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/jobs/ready">Open Jobs</Link>
          </Button>
        </div>
      </section>
    </PageMain>
  </>
);
