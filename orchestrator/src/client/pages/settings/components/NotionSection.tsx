import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import { formatSecretHint } from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useFormContext } from "react-hook-form";

type NotionSectionProps = {
  notionApiKeyHint: string | null;
  notionDatabaseId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const NotionSection: React.FC<NotionSectionProps> = ({
  notionApiKeyHint,
  notionDatabaseId,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    register,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  return (
    <SettingsSectionFrame mode={layoutMode} title="Notion" value="notion">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Connect your Notion workspace to automatically push discovered jobs
          into a tracking database with the job description, language detection,
          and placeholder sections for your tailored CV and cover letter.
        </p>
        <SettingsInput
          label="Notion API Key"
          inputProps={register("notionApiKey")}
          type="password"
          placeholder="secret_..."
          disabled={isLoading || isSaving}
          error={errors.notionApiKey?.message as string | undefined}
          helper='Create an integration at notion.so/my-integrations and paste the "Internal Integration Secret" here.'
          current={formatSecretHint(notionApiKeyHint)}
        />
        <SettingsInput
          label="Database ID"
          inputProps={register("notionDatabaseId")}
          placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          disabled={isLoading || isSaving}
          error={errors.notionDatabaseId?.message as string | undefined}
          helper="Open your Notion database page, copy the 32-character ID from the URL, and share the database with your integration."
          current={notionDatabaseId ?? "—"}
        />
      </div>
    </SettingsSectionFrame>
  );
};
