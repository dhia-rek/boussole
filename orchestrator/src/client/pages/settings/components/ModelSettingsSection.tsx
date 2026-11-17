import { ClaudeModelField } from "@client/components/ClaudeModelField";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { ModelValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useFormContext } from "react-hook-form";

type ModelSettingsSectionProps = {
  values: ModelValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const ModelSettingsSection: React.FC<ModelSettingsSectionProps> = ({
  values,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  return (
    <SettingsSectionFrame mode={layoutMode} title="AI model" value="model">
      <ClaudeModelField
        value={watch("model") ?? ""}
        onChange={(value) =>
          setValue("model", value, { shouldDirty: true, shouldValidate: true })
        }
        effectiveModel={values.effective}
        defaultModel={values.default}
        disabled={isLoading || isSaving}
        error={errors.model?.message as string | undefined}
      />
    </SettingsSectionFrame>
  );
};
