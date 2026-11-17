import { AiAccountPanel } from "@client/components/ai-account/AiAccountPanel";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type React from "react";

type AiAccountSettingsSectionProps = {
  layoutMode?: "accordion" | "panel";
};

/** Saves on its own (sign-in, account and model), outside the settings form. */
export const AiAccountSettingsSection: React.FC<
  AiAccountSettingsSectionProps
> = ({ layoutMode }) => (
  <SettingsSectionFrame mode={layoutMode} title="AI account" value="ai-account">
    <AiAccountPanel />
  </SettingsSectionFrame>
);
