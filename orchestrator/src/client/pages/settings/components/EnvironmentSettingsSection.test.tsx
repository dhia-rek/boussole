import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { Accordion } from "@/components/ui/accordion";
import { EnvironmentSettingsSection } from "./EnvironmentSettingsSection";

const EnvironmentSettingsHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: {
      basicAuthUser: "admin",
      adzunaAppId: "adzuna-id",
      adzunaAppKey: "",
      basicAuthPassword: "super-secret",
      webhookSecret: "",
      enableBasicAuth: true,
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <FormProvider {...methods}>
        <Accordion type="multiple" defaultValue={["environment"]}>
          <EnvironmentSettingsSection
            values={{
              readable: {
                adzunaAppId: "adzuna-id",
                basicAuthUser: "admin",
                basicAuthPassword: "super-secret",
              },
              private: {
                adzunaAppKeyHint: "adzu",
                basicAuthPasswordHint: "abcd",
                webhookSecretHint: "sec-",
              },
              basicAuthActive: true,
            }}
            isLoading={false}
            isSaving={false}
          />
        </Accordion>
      </FormProvider>
    </QueryClientProvider>
  );
};

describe("EnvironmentSettingsSection", () => {
  it("renders values grouped logically and masks private secrets with hints", () => {
    render(<EnvironmentSettingsHarness />);

    expect(screen.getByDisplayValue("adzuna-id")).toBeInTheDocument();
    expect(screen.getByText(/adzu\*{8}/)).toBeInTheDocument();
    // Authentication
    expect(screen.getByLabelText("Enable authentication")).toBeChecked();
    expect(screen.getByDisplayValue("admin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("super-secret")).toBeInTheDocument();

    // Sections
    expect(screen.getByText("Service Accounts")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.queryByText("RxResume")).not.toBeInTheDocument();
    expect(screen.queryByText("UKVisaJobs")).not.toBeInTheDocument();
  });
});
