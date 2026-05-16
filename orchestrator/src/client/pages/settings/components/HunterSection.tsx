import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import { formatSecretHint } from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useFormContext } from "react-hook-form";

type HunterSectionProps = {
  hunterApiKeyHint: string | null;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const HunterSection: React.FC<HunterSectionProps> = ({
  hunterApiKeyHint,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    register,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  return (
    <SettingsSectionFrame mode={layoutMode} title="Hunter.io" value="hunter">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Hunter.io finds professional email addresses for company domains.
          Required for the Spontaneous Applications feature.
        </p>
        <SettingsInput
          label="Hunter.io API Key"
          inputProps={register("hunterApiKey")}
          type="password"
          placeholder="hunter_..."
          disabled={isLoading || isSaving}
          error={errors.hunterApiKey?.message as string | undefined}
          helper="Get your free API key at hunter.io/api-keys. The free plan includes 25 searches/month."
          current={formatSecretHint(hunterApiKeyHint)}
        />
      </div>
    </SettingsSectionFrame>
  );
};
