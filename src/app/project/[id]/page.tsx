import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import WorkspaceGate from "@/components/WorkspaceGate";
import OpenInApp from "@/components/OpenInApp";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { order: "asc" } },
      characters: { orderBy: { name: "asc" } },
      plotPoints: { orderBy: { order: "asc" } },
    },
  });

  if (!project) notFound();
  // Local single-author mode has no account, and a deadline belongs to one.
  const signedIn = Boolean(await getSessionUser().catch(() => null));

  return (
    <>
      <OpenInApp title={project.title} />
      <WorkspaceGate initialProject={project as unknown as Project} signedIn={signedIn} />
    </>
  );
}
