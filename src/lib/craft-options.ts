import { prisma } from "@/lib/db";
import { readBibleFile } from "@/lib/bible";
import { emDashesAllowed } from "@/lib/craft-defaults";
import { defaultSettings, parseSettingsJson } from "@/lib/settings";

// What a prose-writing call needs to know about the project it writes for:
// whether its owner turned on the "Experimental writing prompt" setting (craft
// defaults plus the post-draft check), and the author's em-dash switch in
// style.md. The two are independent: the em-dash switch works with craft
// defaults on or off.

export type ProseOptions = { craft: boolean; emDashes: boolean };

/** Whether the manuscript's owner has the "Experimental writing prompt" setting on. */
export async function craftDefaultsOn(projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { owner: { select: { settingsJson: true, settingsUpdatedAt: true } } },
  });
  if (!project?.owner) return defaultSettings().craftDefaults;
  return parseSettingsJson(project.owner.settingsJson, project.owner.settingsUpdatedAt)
    .craftDefaults;
}

/** The options for a drafter call: craft defaults on or off, and em dashes allowed or not. */
export async function proseOptions(projectId: string): Promise<ProseOptions> {
  const [craft, styleMd] = await Promise.all([
    craftDefaultsOn(projectId),
    readBibleFile(projectId, "style.md"),
  ]);
  return { craft, emDashes: emDashesAllowed(styleMd) };
}
